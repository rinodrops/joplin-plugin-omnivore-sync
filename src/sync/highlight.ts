// sync/highlight.ts
// Sep 2024 by Rino, eMotionGraphics Inc.

import joplin from 'api';
import TurndownService from 'turndown';
import { DateTime } from 'luxon';
import * as Mustache from 'mustache';
import { Highlight } from '../types';
import { OmnivoreClient } from '../api/omnivore';
import { logger } from '../logger';

const HIGHLIGHT_TEMPLATES = {
    default: `
**{{{article.title}}}**

{{{quote}}}
{{#annotation}}
> **Note**:
{{{annotation}}}
{{/annotation}}
> ({{{createdAt}}})

**Author**: {{{article.author}}}
**Published**: {{{article.publishedAt}}}
**URL**: [Omnivore]({{{article.omnivoreUrl}}}), [Original]({{{article.originalArticleUrl}}})
    `,
    titleQuote: `
[{{{article.title}}}]({{{article.omnivoreUrl}}})

{{{quote}}}
{{#annotation}}
> **Note**:
{{{annotation}}}
{{/annotation}}
> ({{{createdAt}}})
    `,
    quoteOnly: `
{{{quote}}}
{{#annotation}}
> **Note**:
{{{annotation}}}
{{/annotation}}
> ({{{createdAt}}})
    `
};

export async function syncHighlights(client: OmnivoreClient, turndownService: TurndownService, lastSyncDate: string, syncPeriod: number, labels: string[], targetFolderId: string): Promise<{ newLastSyncDate: string, syncedHighlights: { [key: string]: string[] } }> {
    const highlights = await client.getHighlights(lastSyncDate, syncPeriod, labels);
    await logger.debug(`Retrieved ${highlights.length} highlights from Omnivore`);

    const userTimezone = await joplin.settings.value('userTimezone') || 'local';
    let syncedHighlights: { [key: string]: string[] } = JSON.parse(await joplin.settings.value('syncedHighlights') || '{}');
    const highlightGrouping = await joplin.settings.value('highlightGrouping');

    let newLastSyncDate = lastSyncDate;
    let newItemsCount = 0;

    // Group highlights based on the chosen grouping method
    const groupedHighlights = groupHighlights(highlights, highlightGrouping, userTimezone);

    // Cache to store notes we've already created or found during this sync
    const noteCache: { [key: string]: any } = {};

    for (const [groupKey, groupHighlights] of Object.entries(groupedHighlights)) {
    await syncGroupedHighlights(groupKey, groupHighlights, syncedHighlights, turndownService, userTimezone, highlightGrouping, targetFolderId, noteCache);

        newItemsCount += groupHighlights.length;
        const latestHighlightDate = groupHighlights.reduce((latest, highlight) => {
            return new Date(highlight.createdAt) > new Date(latest) ? highlight.createdAt : latest;
        }, lastSyncDate);

        if (new Date(latestHighlightDate) > new Date(newLastSyncDate)) {
            newLastSyncDate = latestHighlightDate;
        }
    }

    await joplin.settings.setValue('syncedHighlights', JSON.stringify(syncedHighlights));
    await logger.debug(`Synced ${newItemsCount} new highlights from Omnivore.`);

    return { newLastSyncDate, syncedHighlights };
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

async function syncGroupedHighlights(groupKey: string, highlights: Highlight[], syncedHighlights: { [key: string]: string[] }, turndownService: TurndownService, userTimezone: string, groupingType: string, targetFolderId: string, noteCache: { [key: string]: any }) {
    const titlePrefix = await joplin.settings.value('highlightTitlePrefix');
    let noteTitle;

    if (groupingType === 'byArticle') {
        noteTitle = `${titlePrefix}${highlights[0].article.title}`;
    } else { // byDate
        noteTitle = `${titlePrefix}${groupKey}`;
    }

    let existingNote;
    if (noteCache[groupKey]) {
        existingNote = noteCache[groupKey];
    } else {
        existingNote = await getOrCreateHighlightNote(noteTitle, targetFolderId);
        noteCache[groupKey] = existingNote;
    }

    if (groupingType === 'byArticle') {
        highlights.sort((a, b) => (a.highlightPositionPercent || 0) - (b.highlightPositionPercent || 0));
    } else { // byDate
        highlights.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        highlights = groupHighlightsByArticle(highlights);
    }

    const highlightTemplate = await getHighlightTemplate();
    let newContent = '';
    for (const highlight of highlights) {
        if (!syncedHighlights[groupKey]) {
            syncedHighlights[groupKey] = [];
        }

        if (!syncedHighlights[groupKey].includes(highlight.id)) {
            const highlightContent = renderHighlightContent(highlight, highlightTemplate, userTimezone, turndownService);
            newContent += highlightContent + '\n\n---\n\n';
            syncedHighlights[groupKey].push(highlight.id);
        }
    }

    if (newContent) {
        await appendHighlightsToNote(existingNote.id, newContent.trim());
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
    const searchResult = await joplin.data.get(['search'], { query: `"${title}"`, fields: ['id', 'title', 'body', 'parent_id'] });

    if (searchResult && Array.isArray(searchResult.items) && searchResult.items.length > 0) {
        // If multiple notes exist for the same day, merge them
        if (searchResult.items.length > 1) {
            return await mergeHighlightNotes(searchResult.items, targetFolderId);
        }
        // If the note exists but is in a different folder, move it to the correct folder
        if (searchResult.items[0].parent_id !== targetFolderId) {
            await joplin.data.put(['notes', searchResult.items[0].id], null, { parent_id: targetFolderId });
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

async function mergeHighlightNotes(notes: any[], targetFolderId: string): Promise<any> {
    const mergedBody = notes.map(note => note.body).join('\n\n---\n\n');
    const firstNote = notes[0];
    await joplin.data.put(['notes', firstNote.id], null, {
        body: mergedBody,
        title: firstNote.title,
        parent_id: targetFolderId
    });

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

    // Decode and clean HTML entities in the new highlight content
    newHighlightContent = decodeAndCleanText(newHighlightContent);

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

    // Decode and clean all text fields before passing to Mustache
    const cleanTitle = decodeAndCleanText(highlight.article.title);
    const cleanAuthor = decodeAndCleanText(highlight.article.author || 'Unknown');
    const cleanOmnivoreUrl = decodeAndCleanText(omnivoreUrl);
    const cleanOriginalUrl = decodeAndCleanText(highlight.article.originalArticleUrl || highlight.article.url);

    // Clean and format the quote
    const cleanQuote = decodeAndCleanText(highlight.quote)
        .split('\n')
        .map(line => line.trim() ? `> ${line}` : '>')
        .join('\n');

    // Clean and format the annotation (if it exists)
    const cleanAnnotation = highlight.annotation
        ? decodeAndCleanText(highlight.annotation)
            .split('\n')
            .map(line => line.trim() ? `> ${line}` : '>')
            .join('\n')
        : null;

    const renderResult = decodeAndCleanText(Mustache.render(template, {
        article: {
            title: cleanTitle,
            author: cleanAuthor,
            publishedAt: highlight.article.publishedAt ?
                DateTime.fromISO(highlight.article.publishedAt).setZone(userTimezone).toFormat('yyyy-MM-dd HH:mm') : 'Unknown',
            omnivoreUrl: cleanOmnivoreUrl,
            originalArticleUrl: cleanOriginalUrl
        },
        quote: cleanQuote,
        annotation: cleanAnnotation,
        createdAt: DateTime.fromISO(highlight.createdAt).setZone(userTimezone).toFormat('yyyy-MM-dd HH:mm')
    }));

    return renderResult;
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
    const searchResult = await joplin.data.get(['search'], { query: searchQuery, fields: ['id', 'title', 'body', 'parent_id'] });
    if (!searchResult || !Array.isArray(searchResult.items)) {
        await logger.debug('No highlight notes found or invalid search result');
        return;
    }

    const highlightNotes = searchResult.items;
    const notesByDate: { [key: string]: any[] } = {};

    for (const note of highlightNotes) {
        const datePart = note.title.replace(`${titlePrefix}`, '');
        if (!notesByDate[datePart]) {
            notesByDate[datePart] = [];
        }
        notesByDate[datePart].push(note);
    }

    for (const [date, notes] of Object.entries(notesByDate)) {
        if (notes.length > 1) {
            // Get the parent_id of the first note to use as the target folder
            const targetFolderId = notes[0].parent_id;
            await mergeHighlightNotes(notes, targetFolderId);
        }
    }
}

export function decodeAndCleanText(text: string): string {
    const htmlEntities: { [key: string]: string } = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#x2F;': '/',
        '&#x60;': '`'
    };

    return text
        .replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (match, entity) => {
            if (entity[0] === '#') {
                const code = entity[1].toLowerCase() === 'x'
                    ? parseInt(entity.slice(2), 16)
                    : parseInt(entity.slice(1), 10);
                return String.fromCharCode(code);
            }
            return htmlEntities[match] || match;
        })
        .replace(/\\([\[\]_])/g, '$1')
        .replace(/\\(.)/g, '$1')
        .replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
