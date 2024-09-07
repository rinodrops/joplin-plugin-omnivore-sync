// sync/article.ts
// Aug 2024 by Rino, eMotionGraphics Inc.

import joplin from 'api';
import TurndownService from 'turndown';
import fetch from 'node-fetch';
import { Article, SyncedArticle } from '../types';
import { OmnivoreClient } from '../api/omnivore';
import { logger } from '../logger';
import { Buffer } from 'buffer';

export async function syncArticles(client: OmnivoreClient, turndownService: TurndownService, lastSyncDate: string, labels: string[], targetFolderId: string): Promise<{newLastSyncDate: string, syncedArticles: SyncedArticle[]}> {
    const articles = await client.getArticles(lastSyncDate, labels);
    await logger.debug(`Retrieved ${articles.length} articles from Omnivore`);

    let newLastSyncDate = lastSyncDate;
    let syncedArticles: SyncedArticle[] = JSON.parse(await joplin.settings.value('syncedArticles') || '[]');
    let newItemsCount = 0;

    for (const article of articles) {
        if (!syncedArticles.some(item => item.id === article.id)) {
            await syncArticleToJoplin(article, turndownService, targetFolderId);
            syncedArticles.push({ id: article.id, savedAt: article.savedAt });
            newItemsCount++;
            if (new Date(article.savedAt) > new Date(newLastSyncDate)) {
                newLastSyncDate = article.savedAt;
            }
        }
    }

    await logger.info(`Synced ${newItemsCount} new articles from Omnivore.`);
    return { newLastSyncDate, syncedArticles };
}

async function syncArticleToJoplin(article: Article, turndownService: TurndownService, targetFolderId: string) {
    let markdown = turndownService.turndown(article.content);

    // Simplified regex to catch all cases
    const imageRegex = /!\[([^\]]*)\]\((:\/[a-f0-9]+)(?:\]\([^\)]+\))?\)|\[!\[([^\]]*)\]\((:\/[a-f0-9]+)\)\]\([^\)]+\)|\!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g;

    markdown = markdown.replace(imageRegex, (match, alt1, resourceId1, alt2, resourceId2, alt3, url) => {
        if (resourceId1 || resourceId2) {
            // If a resource ID is present, simplify to just the image with resource ID
            const altText = alt1 || alt2 || '';
            const resourceId = resourceId1 || resourceId2;
            return `![${altText}](${resourceId})`;
        } else if (url) {
            // For now, leave URL-based images as they are
            // We'll handle downloading and replacing these in a separate step
            return match;
        }
        return match; // If none of the above, leave unchanged
    });

    // Now handle remaining URL-based images
    const urlImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g;
    let urlMatch;
    while ((urlMatch = urlImageRegex.exec(markdown)) !== null) {
        const [fullMatch, altText, imageUrl] = urlMatch;
        try {
            // Download the image
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Create attachment in Joplin
            const attachment = await joplin.data.post(['resources'], null, {
                title: altText || 'Image',
                body: buffer
            });

            // Replace the image reference in markdown with just the attachment reference
            const newImageRef = `![${altText}](:/${attachment.id})`;
            markdown = markdown.replace(fullMatch, newImageRef);

            await logger.debug(`Processed image: ${imageUrl} -> Attachment ID: ${attachment.id}`);
        } catch (error) {
            await logger.warn(`Failed to process image: ${imageUrl}`, error);
            // Keep the original image reference unchanged in case of error
        }
    }

    // Create the note with the updated markdown
    await joplin.data.post(['notes'], null, {
        parent_id: targetFolderId,
        title: article.title,
        body: markdown,
        author: 'Omnivore Sync',
        source_url: article.url,
        tags: article.labels ? article.labels.map(label => label.name).join(',') : ''
    });

    await logger.info(`Synced article: ${article.title}`);
}

export async function cleanupOldArticles(syncedArticles: SyncedArticle[]): Promise<SyncedArticle[]> {
    await logger.debug('Starting cleanup process for articles');
    try {
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - 3);

        const recentArticles = syncedArticles.filter(item => {
            const itemSavedAt = new Date(item.savedAt);
            return itemSavedAt >= thresholdDate;
        });

        await logger.debug(`Cleaned up synced articles. Kept ${recentArticles.length} out of ${syncedArticles.length}`);
        return recentArticles;
    } catch (error) {
        await logger.error(`Error in cleanupOldArticles: ${error.message}`);
        return syncedArticles; // Return original array if there's an error
    }
}
