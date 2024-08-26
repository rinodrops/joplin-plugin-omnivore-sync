import joplin from 'api';
import { OmnivoreClient } from './omnivoreClient';
import TurndownService from 'turndown';
import * as Mustache from 'mustache';
import { DateTime } from 'luxon';
import { logger } from './logger';

interface SyncedItem {
    id: string;
    savedAt: string;
    type: 'article' | 'highlight';
}

interface Note {
    id: string;
    title: string;
    body: string;
}

const HIGHLIGHT_TEMPLATES = {
    default: `
**{{article.title}}**

> {{quote}}{{#annotation}}
> **Note**: {{annotation}}{{/annotation}}
> ({{createdAt}})

**Author**: {{article.author}}
**Published**: {{article.publishedAt}}
**URL**: [Omnivore]({{article.omnivoreUrl}}), [Original]({{article.originalArticleUrl}})
    `,
    minimal: `
> {{quote}}

{{#annotation}}{{annotation}}{{/annotation}}

[Source]({{article.url}})
    `
};

async function getHighlightTemplate() {
    const choice = await joplin.settings.value('highlightTemplateChoice');
    return HIGHLIGHT_TEMPLATES[choice].trim();
}

function decodeHtmlEntities(text: string): string {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'"
    };
    return text.replace(/&#x([0-9A-Fa-f]+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 16)))
        .replace(/&[#A-Za-z0-9]+;/g, entity => entities[entity] || entity);
}

export async function syncArticles(client: OmnivoreClient, turndownService: TurndownService) {
    console.log('Starting Omnivore sync');
    let lastSyncDate = await joplin.settings.value('lastSyncDate');
    let syncedItems: SyncedItem[] = JSON.parse(await joplin.settings.value('syncedItems') || '[]');
    const syncType = await joplin.settings.value('syncType');
    const highlightSyncPeriod = await joplin.settings.value('highlightSyncPeriod');

    if (!lastSyncDate) {
        lastSyncDate = new Date(0).toISOString();
        console.log('Last sync date was reset or not set. Using earliest possible date.');
    }

    console.log(`Last sync date: ${lastSyncDate}`);
    console.log(`Synced item count: ${syncedItems.length}`);
    console.log(`Sync type: ${syncType}`);

    try {
        let newLastSyncDate = lastSyncDate;

        if (syncType === 'all' || syncType === 'articles') {
            newLastSyncDate = await syncOmnivoreArticles(client, turndownService, syncedItems, lastSyncDate, newLastSyncDate);
        }

        if (syncType === 'all' || syncType === 'highlights') {
            newLastSyncDate = await syncOmnivoreHighlights(client, turndownService, lastSyncDate, newLastSyncDate, highlightSyncPeriod);
        }

        // Run cleanup after sync
        await cleanupHighlightNotes();

        syncedItems = await cleanupOldItems(syncedItems);

        await joplin.settings.setValue('lastSyncDate', newLastSyncDate);
        await joplin.settings.setValue('syncedItems', JSON.stringify(syncedItems));
        console.log(`Sync completed. New last sync date: ${newLastSyncDate}`);
    } catch (error) {
        console.error(`Error during sync: ${error.message}`);
    }
}

async function syncOmnivoreArticles(client: OmnivoreClient, turndownService: TurndownService, syncedItems: SyncedItem[], lastSyncDate: string, newLastSyncDate: string): Promise < string > {
    const articles = await client.getArticles(lastSyncDate);
    console.log(`Retrieved ${articles.length} articles from Omnivore`);

    let newItemsCount = 0;
    for (const article of articles) {
        if (!syncedItems.some(item => item.id === article.id && item.type === 'article')) {
            await syncArticleToJoplin(article, turndownService);
            syncedItems.push({ id: article.id, savedAt: article.savedAt, type: 'article' });
            newItemsCount++;
            if (new Date(article.savedAt) > new Date(newLastSyncDate)) {
                newLastSyncDate = article.savedAt;
            }
        }
    }
    console.log(`Synced ${newItemsCount} new articles from Omnivore.`);
    return newLastSyncDate;
}

async function syncOmnivoreHighlights(client: OmnivoreClient, turndownService: TurndownService, lastSyncDate: string, newLastSyncDate: string, syncPeriod: number): Promise < string > {
    const highlights = await client.getHighlights(lastSyncDate, syncPeriod);
    console.log(`Retrieved ${highlights.length} highlights from Omnivore`);

    const userTimezone = await joplin.settings.value('userTimezone') || 'local';
    let syncedHighlights: {
        [key: string]: string[] } = JSON.parse(await joplin.settings.value('syncedHighlights') || '{}');

    // Cache to store notes we've already created or found during this sync
    const noteCache: {
        [key: string]: any } = {};

    let newItemsCount = 0;
    for (const highlight of highlights) {
        const highlightDate = DateTime.fromISO(highlight.createdAt).setZone(userTimezone).toFormat('yyyy-MM-dd');
        console.log(`Processing highlight ${highlight.id} for date ${highlightDate}`);

        if (!syncedHighlights[highlightDate]) {
            syncedHighlights[highlightDate] = [];
        }

        if (!syncedHighlights[highlightDate].includes(highlight.id)) {
            await syncHighlightToJoplin(highlight, turndownService, userTimezone, noteCache);
            syncedHighlights[highlightDate].push(highlight.id);
            newItemsCount++;
            if (new Date(highlight.createdAt) > new Date(newLastSyncDate)) {
                newLastSyncDate = highlight.createdAt;
            }
            console.log(`Synced highlight ${highlight.id}`);
        } else {
            console.log(`Skipping already synced highlight: ${highlight.id}`);
        }
    }

    await joplin.settings.setValue('syncedHighlights', JSON.stringify(syncedHighlights));
    console.log(`Synced ${newItemsCount} new highlights from Omnivore.`);
    return newLastSyncDate;
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

async function syncHighlightToJoplin(highlight, turndownService: TurndownService, userTimezone: string, noteCache: {
    [key: string]: any }) {
    console.log(`Syncing highlight: ${highlight.id}`);
    try {
        const highlightDateTime = DateTime.fromISO(highlight.createdAt).setZone(userTimezone);
        const highlightDate = highlightDateTime.toFormat('yyyy-MM-dd');

        const titlePrefix = await joplin.settings.value('highlightTitlePrefix');
        const noteTitle = `${titlePrefix} ${highlightDate}`;
        console.log(`Note title for highlight ${highlight.id}: ${noteTitle}`);

        let existingNote;
        if (noteCache[highlightDate]) {
            existingNote = noteCache[highlightDate];
            console.log(`Using cached note for ${highlightDate}`);
        } else {
            existingNote = await getOrCreateHighlightNote(noteTitle);
            noteCache[highlightDate] = existingNote;
            console.log(`Created or found note for ${highlightDate}: ${existingNote.id}`);
        }

        const highlightTemplate = await getHighlightTemplate();

        // Determine the Omnivore URL
        let omnivoreUrl = 'https://omnivore.app/me/';
        if (highlight.article.slug) {
            omnivoreUrl += highlight.article.slug;
        } else if (highlight.article.id) {
            omnivoreUrl += highlight.article.id;
        } else {
            // Fallback to using the highlight id if neither slug nor article id is available
            omnivoreUrl += highlight.id;
        }

        const highlightContent = decodeHtmlEntities(Mustache.render(highlightTemplate, {
            article: {
                title: highlight.article.title,
                author: highlight.article.author || 'Unknown',
                publishedAt: highlight.article.publishedAt ?
                    DateTime.fromISO(highlight.article.publishedAt).setZone(userTimezone).toFormat('yyyy-MM-dd HH:mm') : 'Unknown',
                omnivoreUrl: omnivoreUrl,
                originalArticleUrl: highlight.article.originalArticleUrl || highlight.article.url
            },
            quote: turndownService.turndown(highlight.quote),
            annotation: highlight.annotation ? turndownService.turndown(highlight.annotation) : null,
            createdAt: highlightDateTime.toFormat('yyyy-MM-dd HH:mm')
        }));

        console.log(`Highlight content created for ${highlight.id}`);
        await appendHighlightToNote(existingNote.id, highlightContent.trim(), highlight.id);

        console.log(`Successfully synced highlight: ${highlight.id}`);
    } catch (error) {
        console.error(`Error syncing highlight ${highlight.id}: ${error.message}`);
    }
}

async function getOrCreateHighlightNote(title: string): Promise < any > {
    const searchResult = await joplin.data.get(['search'], { query: `"${title}"`, fields: ['id', 'title', 'body'] });

    if (searchResult && Array.isArray(searchResult.items) && searchResult.items.length > 0) {
        // If multiple notes exist for the same day, merge them
        if (searchResult.items.length > 1) {
            return await mergeHighlightNotes(searchResult.items);
        }
        return searchResult.items[0];
    } else {
        const targetNotebook = await joplin.settings.value('targetNotebook');
        const folderItem = await getOrCreateNotebook(targetNotebook);
        return await joplin.data.post(['notes'], null, {
            parent_id: folderItem.id,
            title: title,
            body: ''
        });
    }
}

async function mergeHighlightNotes(notes: Note[]): Promise < Note > {
    const mergedBody = notes.map(note => note.body).join('\n\n---\n\n');
    const firstNote = notes[0];
    await joplin.data.put(['notes', firstNote.id], null, { body: mergedBody, title: firstNote.title });

    // Delete other notes
    for (let i = 1; i < notes.length; i++) {
        await joplin.data.delete(['notes', notes[i].id]);
    }

    console.log(`Merged ${notes.length} notes for ${firstNote.title}`);
    return firstNote;
}

async function appendAndSortHighlightsInNote(noteId: string, newHighlightContent: string) {
    const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
    const highlights = note.body ? note.body.split('\n\n---\n\n').filter(h => h.trim() !== '') : [];

    // Check if the highlight already exists in the note
    const exists = highlights.some(h => h.includes(newHighlightContent.split('\n')[0]));
    if (!exists) {
        highlights.push(newHighlightContent);
    }

    // Sort highlights by their creation time
    highlights.sort((a, b) => {
        const getCreationTime = (highlight) => {
            const match = highlight.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)/);
            return match ? match[1] : '';
        };
        return getCreationTime(a).localeCompare(getCreationTime(b));
    });

    const updatedBody = highlights.join('\n\n---\n\n');
    await joplin.data.put(['notes', noteId], null, { body: updatedBody });
}

async function getOrCreateNotebook(notebookName: string): Promise < any > {
    const folders = await joplin.data.get(['folders']);
    const existingFolder = folders.items.find(folder => folder.title === notebookName);
    if (existingFolder) {
        return existingFolder;
    } else {
        return await joplin.data.post(['folders'], null, { title: notebookName });
    }
}

async function findExistingHighlightNote(title: string): Promise < any > {
    const notes = await joplin.data.get(['search'], { query: title, fields: ['id', 'title', 'body'] });
    return notes.items.find(note => note.title === title);
}

async function createNewHighlightNote(title: string): Promise < any > {
    const targetNotebook = await joplin.settings.value('targetNotebook');
    const folderItem = await getOrCreateNotebook(targetNotebook);
    return await joplin.data.post(['notes'], null, {
        parent_id: folderItem.id,
        title: title,
        body: ''
    });
}

async function appendHighlightToNote(noteId: string, newHighlightContent: string, highlightId: string) {
    console.log(`Appending highlight ${highlightId} to note ${noteId}`);
    const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
    let highlights = note.body ? note.body.split('\n\n---\n\n').filter(h => h.trim() !== '') : [];
    console.log(`Existing highlights in note: ${highlights.length}`);

    // Extract creation time and a portion of the content for comparison
    const newHighlightCreationTime = newHighlightContent.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)/)?.[1] || '';
    const newHighlightFirstLine = newHighlightContent.split('\n')[0];

    // Check if the highlight already exists in the note
    const exists = highlights.some(h => {
        const existingCreationTime = h.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)/)?.[1] || '';
        const existingFirstLine = h.split('\n')[0];
        return existingCreationTime === newHighlightCreationTime && existingFirstLine === newHighlightFirstLine;
    });

    if (!exists) {
        highlights.push(newHighlightContent);
        console.log(`New highlight ${highlightId} added to the list`);
    } else {
        console.log(`Highlight ${highlightId} already exists in the note, skipping`);
    }

    // Sort highlights by their creation time
    highlights.sort((a, b) => {
        const getCreationTime = (highlight) => {
            const match = highlight.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)/);
            return match ? match[1] : '';
        };
        return getCreationTime(b).localeCompare(getCreationTime(a)); // Reverse sort (newest first)
    });

    const updatedBody = highlights.join('\n\n---\n\n');
    await joplin.data.put(['notes', noteId], null, { body: updatedBody });

    console.log(`Updated note ${noteId}. Total highlights after update: ${highlights.length}`);
}

async function cleanupOldItems(syncedItems: SyncedItem[]): Promise < SyncedItem[] > {
    console.log('Starting cleanup process');
    try {
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - 3);

        const recentItems = syncedItems.filter(item => {
            if (item.type === 'highlight') return true; // Keep all highlight records
            const itemSavedAt = new Date(item.savedAt);
            const keepItem = itemSavedAt >= thresholdDate;
            console.log(`Article ${item.id} saved at: ${item.savedAt}, keep: ${keepItem}`);
            return keepItem;
        });

        console.log(`Cleaned up synced items. Kept ${recentItems.length} out of ${syncedItems.length}`);
        return recentItems;
    } catch (error) {
        console.error(`Error in cleanupOldItems: ${error.message}`);
        return syncedItems; // Return original array if there's an error
    }
}

async function cleanupHighlightNotes() {
    const titlePrefix = await joplin.settings.value('highlightTitlePrefix');
    const searchQuery = `${titlePrefix}*`;
    const searchResult = await joplin.data.get(['search'], { query: searchQuery, fields: ['id', 'title', 'body'] });
    if (!searchResult || !Array.isArray(searchResult.items)) {
        console.log('No highlight notes found or invalid search result');
        return;
    }

    const highlightNotes = searchResult.items as Note[];
    const notesByDate: { [key: string]: Note[] } = {};

    for (const note of highlightNotes) {
        const datePart = note.title.replace(`${titlePrefix} `, '');
        if (!notesByDate[datePart]) {
            notesByDate[datePart] = [];
        }
        notesByDate[datePart].push(note);
    }

    for (const [date, notes] of Object.entries(notesByDate)) {
        if (notes.length > 1) {
            await mergeHighlightNotes(notes);
        }
    }
}
