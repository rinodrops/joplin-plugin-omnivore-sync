// sync/highlight.ts
// Aug 2024 by Rino, eMotionGraphics Inc.

import joplin from 'api';
import TurndownService from 'turndown';
import { DateTime } from 'luxon';
import * as Mustache from 'mustache';
import { Highlight } from '../types';
import { OmnivoreClient } from '../api/omnivore';
import { logger } from '../logger';

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
    titleQuote: `
[{{article.title}}]({{article.omnivoreUrl}})
> {{quote}}{{#annotation}}
> **Note**: {{annotation}}{{/annotation}}
> ({{createdAt}})
    `,
    quoteOnly: `
> {{quote}}{{#annotation}}
> **Note**: {{annotation}}{{/annotation}}
> ({{createdAt}})
    `
};

export async function syncHighlights(client: OmnivoreClient, turndownService: TurndownService, lastSyncDate: string, syncPeriod: number, labels: string[], targetFolderId: string): Promise<{ newLastSyncDate: string, syncedHighlights: { [key: string]: string[] } }> {
    const highlights = await client.getHighlights(lastSyncDate, syncPeriod, labels);
    await logger.debug(`Retrieved ${highlights.length} highlights from Omnivore`);

    const userTimezone = await joplin.settings.value('userTimezone') || 'local';
    let syncedHighlights: { [key: string]: string[] } = JSON.parse(await joplin.settings.value('syncedHighlights') || '{}');

    let newLastSyncDate = lastSyncDate;
    let newItemsCount = 0;

    // Cache to store notes we've already created or found during this sync
    const noteCache: { [key: string]: any } = {};

    for (const highlight of highlights) {
        const highlightDate = DateTime.fromISO(highlight.createdAt).setZone(userTimezone).toFormat('yyyy-MM-dd');
        await logger.debug(`Processing highlight ${highlight.id} for date ${highlightDate}`);

        if (!syncedHighlights[highlightDate]) {
            syncedHighlights[highlightDate] = [];
        }

        if (!syncedHighlights[highlightDate].includes(highlight.id)) {
            await syncHighlightToJoplin(highlight, turndownService, userTimezone, noteCache, targetFolderId);
            syncedHighlights[highlightDate].push(highlight.id);
            newItemsCount++;
            if (new Date(highlight.createdAt) > new Date(newLastSyncDate)) {
                newLastSyncDate = highlight.createdAt;
            }
            await logger.debug(`Synced highlight ${highlight.id}`);
        } else {
            await logger.debug(`Skipping already synced highlight: ${highlight.id}`);
        }
    }

    await joplin.settings.setValue('syncedHighlights', JSON.stringify(syncedHighlights));
    await logger.debug(`Synced ${newItemsCount} new highlights from Omnivore.`);

    return { newLastSyncDate, syncedHighlights };
}

async function syncHighlightToJoplin(highlight: Highlight, turndownService: TurndownService, userTimezone: string, noteCache: { [key: string]: any }, targetFolderId: string) {
    await logger.debug(`Syncing highlight: ${highlight.id}`);
    try {
        const highlightDateTime = DateTime.fromISO(highlight.createdAt).setZone(userTimezone);
        const highlightDate = highlightDateTime.toFormat('yyyy-MM-dd');

        const titlePrefix = await joplin.settings.value('highlightTitlePrefix');
        const noteTitle = `${titlePrefix} ${highlightDate}`;
        await logger.debug(`Note title for highlight ${highlight.id}: ${noteTitle}`);

        let existingNote;
        if (noteCache[highlightDate]) {
            existingNote = noteCache[highlightDate];
            await logger.debug(`Using cached note for ${highlightDate}`);
        } else {
            existingNote = await getOrCreateHighlightNote(noteTitle, targetFolderId);
            noteCache[highlightDate] = existingNote;
            await logger.debug(`Created or found note for ${highlightDate}: ${existingNote.id}`);
        }

        const highlightTemplate = await getHighlightTemplate();
        const highlightContent = renderHighlightContent(highlight, highlightTemplate, userTimezone, turndownService);

        await logger.debug(`Highlight content created for ${highlight.id}`);
        await appendHighlightToNote(existingNote.id, highlightContent.trim(), highlight.id);

        await logger.debug(`Successfully synced highlight: ${highlight.id}`);
    } catch (error) {
        await logger.error(`Error syncing highlight ${highlight.id}: ${error.message}`);
    }
}

function groupHighlights(highlights: Highlight[], groupingType: string, userTimezone: string): { [key: string]: Highlight[] } {
    const grouped: { [key: string]: Highlight[] } = {};

    for (const highlight of highlights) {
        let key;
        if (groupingType === 'byArticle') {
            key = highlight.article.id;
        } else { // byDate
            key = DateTime.fromISO(highlight.createdAt).setZone(userTimezone).toFormat('yyyy-MM-dd');
        }

        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(highlight);
    }

    return grouped;
}

async function syncGroupedHighlights(groupKey: string, highlights: Highlight[], syncedHighlights: { [key: string]: string[] }, turndownService: TurndownService, userTimezone: string, groupingType: string, targetFolderId: string) {
    const titlePrefix = await joplin.settings.value('highlightTitlePrefix');
    let noteTitle;

    if (groupingType === 'byArticle') {
        noteTitle = `${titlePrefix} - ${highlights[0].article.title}`;
    } else { // byDate
        noteTitle = `${titlePrefix} ${groupKey}`;
    }

    let existingNote = await getOrCreateHighlightNote(noteTitle, targetFolderId);

    if (groupingType === 'byArticle') {
        highlights.sort((a, b) => (a.highlightPositionPercent || 0) - (b.highlightPositionPercent || 0));
    } else { // byDate
        highlights.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        highlights = groupHighlightsByArticle(highlights);
    }

    const highlightTemplate = await getHighlightTemplate();
    let noteContent = '';

    for (const highlight of highlights) {
        if (!syncedHighlights[groupKey]) {
            syncedHighlights[groupKey] = [];
        }

        if (!syncedHighlights[groupKey].includes(highlight.id)) {
            const highlightContent = renderHighlightContent(highlight, highlightTemplate, userTimezone, turndownService);
            noteContent += highlightContent.trim() + '\n\n---\n\n';
            syncedHighlights[groupKey].push(highlight.id);
        }
    }

    if (noteContent) {
        await appendHighlightsToNote(existingNote.id, noteContent.trim());
    }
}

function groupHighlightsByArticle(highlights: Highlight[]): Highlight[] {
    const articleGroups: { [key: string]: Highlight[] } = {};

    for (const highlight of highlights) {
        if (!articleGroups[highlight.article.id]) {
            articleGroups[highlight.article.id] = [];
        }
        articleGroups[highlight.article.id].push(highlight);
    }

    return Object.values(articleGroups).flat();
}

async function appendHighlightsToNote(noteId: string, newContent: string) {
    const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
    const updatedBody = note.body ? note.body + '\n\n' + newContent : newContent;
    await joplin.data.put(['notes', noteId], null, { body: updatedBody });
}

async function getOrCreateHighlightNote(title: string, targetFolderId: string): Promise<any> {
    const searchResult = await joplin.data.get(['search'], { query: `"${title}"`, fields: ['id', 'title', 'body'] });

    if (searchResult && Array.isArray(searchResult.items) && searchResult.items.length > 0) {
        // If multiple notes exist for the same day, merge them
        if (searchResult.items.length > 1) {
            return await mergeHighlightNotes(searchResult.items);
        }
        return searchResult.items[0];
    } else {
        return await joplin.data.post(['notes'], null, {
            parent_id: targetFolderId,
            title: title,
            body: ''
        });
    }
}


async function mergeHighlightNotes(notes: any[]): Promise < any > {
    const mergedBody = notes.map(note => note.body).join('\n\n---\n\n');
    const firstNote = notes[0];
    await joplin.data.put(['notes', firstNote.id], null, { body: mergedBody, title: firstNote.title });

    // Delete other notes
    for (let i = 1; i < notes.length; i++) {
        await joplin.data.delete(['notes', notes[i].id]);
    }

    await logger.debug(`Merged ${notes.length} notes for ${firstNote.title}`);
    return firstNote;
}

async function appendHighlightToNote(noteId: string, newHighlightContent: string, highlightId: string) {
    await logger.debug(`Appending highlight ${highlightId} to note ${noteId}`);
    const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
    let highlights = note.body ? note.body.split('\n\n---\n\n').filter(h => h.trim() !== '') : [];
    await logger.debug(`Existing highlights in note: ${highlights.length}`);

    // Decode HTML entities in the new highlight content
    newHighlightContent = decodeHtmlEntities(newHighlightContent);

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
        await logger.debug(`New highlight ${highlightId} added to the list`);
    } else {
        await logger.debug(`Highlight ${highlightId} already exists in the note, skipping`);
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

    await logger.debug(`Updated note ${noteId}. Total highlights after update: ${highlights.length}`);
}

async function getHighlightTemplate(): Promise < string > {
    const choice = await joplin.settings.value('highlightTemplateChoice');
    return HIGHLIGHT_TEMPLATES[choice].trim();
}

function renderHighlightContent(highlight: Highlight, template: string, userTimezone: string, turndownService: TurndownService): string {
    let omnivoreUrl = 'https://omnivore.app/me/';
    if (highlight.article.slug) {
        omnivoreUrl += highlight.article.slug;
    } else if (highlight.article.id) {
        omnivoreUrl += highlight.article.id;
    } else {
        omnivoreUrl += highlight.id;
    }

    return Mustache.render(template, {
        article: {
            title: decodeHtmlEntities(highlight.article.title),
            author: decodeHtmlEntities(highlight.article.author || 'Unknown'),
            publishedAt: highlight.article.publishedAt ?
                DateTime.fromISO(highlight.article.publishedAt).setZone(userTimezone).toFormat('yyyy-MM-dd HH:mm') : 'Unknown',
            omnivoreUrl: decodeHtmlEntities(omnivoreUrl),
            originalArticleUrl: decodeHtmlEntities(highlight.article.originalArticleUrl || highlight.article.url)
        },
        quote: decodeHtmlEntities(turndownService.turndown(highlight.quote)),
        annotation: highlight.annotation ? decodeHtmlEntities(turndownService.turndown(highlight.annotation)) : null,
        createdAt: DateTime.fromISO(highlight.createdAt).setZone(userTimezone).toFormat('yyyy-MM-dd HH:mm')
    });
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

export async function cleanupHighlightNotes() {
    const titlePrefix = await joplin.settings.value('highlightTitlePrefix');
    const searchQuery = `${titlePrefix}*`;
    const searchResult = await joplin.data.get(['search'], { query: searchQuery, fields: ['id', 'title', 'body'] });
    if (!searchResult || !Array.isArray(searchResult.items)) {
        await logger.debug('No highlight notes found or invalid search result');
        return;
    }

    const highlightNotes = searchResult.items;
    const notesByDate: {
        [key: string]: any[] } = {};

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

export function decodeHtmlEntities(text: string): string {
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
