import joplin from 'api';
import { OmnivoreClient } from './omnivoreClient';
import TurndownService from 'turndown';
import * as Mustache from 'mustache';

interface SyncedItem {
    id: string;
    savedAt: string;
}

const HIGHLIGHT_TEMPLATES = {
    default: `
## {{article.title}}

> {{quote}}

[Link to highlight]({{article.url}})

Created: {{createdAt}}

{{#annotation}}Note: {{annotation}}{{/annotation}}
    `,
    minimal: `
> {{quote}}

{{#annotation}}{{annotation}}{{/annotation}}

[Source]({{article.url}})
    `,
    detailed: `
# Highlight from {{article.title}}

**Quote:**
> {{quote}}

**Source:** [{{article.title}}]({{article.url}})
**Created:** {{createdAt}}

{{#annotation}}**Note:**
{{annotation}}{{/annotation}}

---
    `
};

async function getHighlightTemplate() {
    const choice = await joplin.settings.value('highlightTemplateChoice');
    return HIGHLIGHT_TEMPLATES[choice].trim();
}

export async function syncArticles(client: OmnivoreClient, turndownService: TurndownService) {
    console.log('Starting Omnivore sync');
    let lastSyncDate = await joplin.settings.value('lastSyncDate');
    let syncedItems: SyncedItem[] = JSON.parse(await joplin.settings.value('syncedItems') || '[]');
    const syncType = await joplin.settings.value('syncType');

    if (!lastSyncDate) {
        lastSyncDate = new Date(0).toISOString();
        console.log('Last sync date was reset or not set. Using earliest possible date.');
    }

    console.log(`Last sync date: ${lastSyncDate}`);
    console.log(`Synced item count: ${syncedItems.length}`);
    console.log(`Sync type: ${syncType}`);

    try {
        let newItemsCount = 0;
        let newLastSyncDate = lastSyncDate;

        if (syncType === 'all' || syncType === 'articles') {
            const articles = await client.getArticles(lastSyncDate);
            console.log(`Retrieved ${articles.length} articles from Omnivore`);

            for (const article of articles) {
                if (!syncedItems.some(item => item.id === article.id)) {
                    await syncArticleToJoplin(article, turndownService);
                    syncedItems.push({ id: article.id, savedAt: article.savedAt });
                    newItemsCount++;
                    if (new Date(article.savedAt) > new Date(newLastSyncDate)) {
                        newLastSyncDate = article.savedAt;
                    }
                }
            }
        }

        if (syncType === 'all' || syncType === 'highlights') {
            const highlights = await client.getHighlights(lastSyncDate);
            console.log(`Retrieved ${highlights.length} highlights from Omnivore`);

            for (const highlight of highlights) {
                if (!syncedItems.some(item => item.id === highlight.id)) {
                    await syncHighlightToJoplin(highlight, turndownService);
                    syncedItems.push({ id: highlight.id, savedAt: highlight.createdAt });
                    newItemsCount++;
                    if (new Date(highlight.createdAt) > new Date(newLastSyncDate)) {
                        newLastSyncDate = highlight.createdAt;
                    }
                }
            }
        }

        syncedItems = await cleanupOldItems(syncedItems, newLastSyncDate);

        await joplin.settings.setValue('lastSyncDate', newLastSyncDate);
        await joplin.settings.setValue('syncedItems', JSON.stringify(syncedItems));
        console.log(`Sync completed. New last sync date: ${newLastSyncDate}`);
        console.log(`Synced ${newItemsCount} new items from Omnivore.`);
    } catch (error) {
        console.error(`Error during sync: ${error.message}`);
    }
}

async function syncArticleToJoplin(article, turndownService: TurndownService) {
    console.log(`Syncing new article: ${article.title}`);
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
        console.log(`Successfully synced article: ${article.title}`);
    } catch (error) {
        console.error(`Error syncing article ${article.title}: ${error.message}`);
    }
}

async function syncHighlightToJoplin(highlight, turndownService: TurndownService) {
    console.log(`Syncing new highlight: ${highlight.id}`);
    try {
        const highlightDate = new Date(highlight.createdAt).toISOString().split('T')[0];
        const noteTitle = `Highlights ${highlightDate}`;

        const existingNote = await findOrCreateHighlightNote(noteTitle);

        const highlightTemplate = await getHighlightTemplate();

        const highlightContent = Mustache.render(highlightTemplate, {
            article: highlight.article,
            quote: turndownService.turndown(highlight.quote),
            createdAt: highlight.createdAt,
            annotation: highlight.annotation ? turndownService.turndown(highlight.annotation) : null
        });

        const updatedBody = existingNote.body + '\n\n' + highlightContent;

        await joplin.data.put(['notes', existingNote.id], null, {
            body: updatedBody
        });

        console.log(`Successfully synced highlight: ${highlight.id}`);
    } catch (error) {
        console.error(`Error syncing highlight ${highlight.id}: ${error.message}`);
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

async function findOrCreateHighlightNote(title: string): Promise<any> {
    const targetNotebook = await joplin.settings.value('targetNotebook');
    const folderItem = await getOrCreateNotebook(targetNotebook);

    const existingNotes = await joplin.data.get(['search'], { query: title, fields: ['id', 'body', 'parent_id'] });
    const noteInCorrectFolder = existingNotes.items.find(note => note.parent_id === folderItem.id);

    if (noteInCorrectFolder) {
        return noteInCorrectFolder;
    } else {
        return await joplin.data.post(['notes'], null, {
            parent_id: folderItem.id,
            title: title,
            body: ''
        });
    }
}

async function cleanupOldItems(syncedItems: SyncedItem[], lastSyncDate: string): Promise<SyncedItem[]> {
    console.log('Starting cleanup process');
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        console.log(`Thirty days ago: ${thirtyDaysAgo}`);
        console.log(`Last sync date: ${lastSyncDate}`);

        const oldestDateToKeep = new Date(lastSyncDate) > new Date(thirtyDaysAgo) ? lastSyncDate : thirtyDaysAgo;
        console.log(`Oldest date to keep: ${oldestDateToKeep}`);

        const recentItems = syncedItems.filter(item => {
            const keepItem = new Date(item.savedAt) >= new Date(oldestDateToKeep);
            console.log(`Item ${item.id} saved at: ${item.savedAt}, keep: ${keepItem}`);
            return keepItem;
        });

        console.log(`Cleaned up synced items. Kept ${recentItems.length} out of ${syncedItems.length}`);
        return recentItems;
    } catch (error) {
        console.error(`Error in cleanupOldItems: ${error.message}`);
        return syncedItems;  // Return original array if there's an error
    }
}
