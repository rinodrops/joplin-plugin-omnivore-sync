// src/sync/article.ts
// Aug 2024 by Rino, eMotionGraphics Inc.

import joplin from 'api';
import TurndownService from 'turndown';
import { Article, SyncedArticle } from '../types';
import { OmnivoreClient } from '../api/omnivore';
import { logger } from '../logger';

export async function syncArticles(client: OmnivoreClient, turndownService: TurndownService, lastSyncDate: string): Promise<{newLastSyncDate: string, syncedArticles: SyncedArticle[]}> {
    const articles = await client.getArticles(lastSyncDate);
    await logger.debug(`Retrieved ${articles.length} articles from Omnivore`);

    let newLastSyncDate = lastSyncDate;
    let syncedArticles: SyncedArticle[] = JSON.parse(await joplin.settings.value('syncedArticles') || '[]');
    let newItemsCount = 0;

    for (const article of articles) {
        if (!syncedArticles.some(item => item.id === article.id)) {
            await syncArticleToJoplin(article, turndownService);
            syncedArticles.push({ id: article.id, savedAt: article.savedAt });
            newItemsCount++;
            if (new Date(article.savedAt) > new Date(newLastSyncDate)) {
                newLastSyncDate = article.savedAt;
            }
        }
    }

    await logger.info(`Synced ${newItemsCount} new articles from Omnivore.`);
    await joplin.settings.setValue('syncedArticles', JSON.stringify(syncedArticles));

    return { newLastSyncDate, syncedArticles };
}

async function syncArticleToJoplin(article: Article, turndownService: TurndownService) {
    await logger.debug(`Syncing new article: ${article.title}`);
    try {
        const markdown = turndownService.turndown(article.content);
        const targetNotebook = await joplin.settings.value('targetNotebook');
        const folderItem = await getOrCreateNotebook(targetNotebook);

        await joplin.data.post(['notes'], null, {
            parent_id: folderItem.id,
            title: article.title,
            body: markdown,
            author: 'Omnivore Sync',
            source_url: article.url,
            tags: article.labels ? article.labels.map(label => label.name).join(',') : ''
        });
        await logger.debug(`Successfully synced article: ${article.title}`);
    } catch (error) {
        await logger.error(`Error syncing article ${article.title}: ${error.message}`);
    }
}

async function getOrCreateNotebook(notebookName: string): Promise<any> {
    const folders = await joplin.data.get(['folders']);
    const existingFolder = folders.items.find(folder => folder.title === notebookName);
    if (existingFolder) {
        return existingFolder;
    } else {
        return await joplin.data.post(['folders'], null, { title: notebookName });
    }
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
