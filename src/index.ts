// index.ts
// Aug 2024 by Rino, eMotionGraphics Inc.

import joplin from 'api';
import { MenuItemLocation, SettingItemType } from 'api/types';
import { OmnivoreClient } from './api/omnivore';
import { syncArticles, cleanupOldArticles } from './sync/article';
import { syncHighlights, cleanupHighlightNotes } from './sync/highlight';
import TurndownService from 'turndown';
import { logger, LogLevel } from './logger';
import { SyncType } from './types';

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

// Custom rule to handle headings
turndownService.addRule('heading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: function(content, node, options) {
        const hLevel = Number(node.nodeName.charAt(1));
        const cleanContent = content.replace(/\[]\([^)]+\)/g, '');
        return '\n\n' + '#'.repeat(hLevel) + ' ' + cleanContent.trim() + '\n\n';
    }
});

joplin.plugins.register({
    onStart: async function() {
        await joplin.settings.registerSection('omnivoreSync', {
            label: 'Omnivore Sync',
            iconName: 'fas fa-sync'
        });

        await joplin.settings.registerSettings({
            'omnivoreApiKey': {
                value: '',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Omnivore API Key'
            },
            'syncType': {
                value: SyncType.All,
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Sync Type',
                description: 'Choose what to sync from Omnivore',
                isEnum: true,
                options: {
                    'all': 'Articles, highlights and annotations',
                    'articles': 'Articles only',
                    'highlights': 'Highlights and annotations only'
                }
            },
            'syncInterval': {
                value: 0,
                type: SettingItemType.Int,
                section: 'omnivoreSync',
                public: true,
                label: 'Sync Interval (minutes)',
                description: '0 for manual sync only'
            },
            'targetNotebook': {
                value: 'Omnivore',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Target Notebook',
                description: 'Name of the notebook to sync Omnivore articles to'
            },
            'articleLabels': {
                value: '',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Article Labels',
                description: 'Comma-separated list of labels for articles to sync (leave empty to sync all)'
            },
            'highlightLabels': {
                value: '',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Highlight Labels',
                description: 'Comma-separated list of labels for highlights to sync (leave empty to sync all)'
            },
            'highlightTemplateChoice': {
                value: 'default',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Highlight Template',
                description: 'Choose the template for formatting highlights',
                isEnum: true,
                options: {
                    default: 'Default',
                    minimal: 'Minimal',
                }
            },
            'userTimezone': {
                value: 'local',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Your Timezone',
                description: 'Enter your timezone (e.g., "America/New_York", "Europe/London", or "local" for system timezone)'
            },
            'highlightSyncPeriod': {
                value: 14,
                type: SettingItemType.Int,
                section: 'omnivoreSync',
                public: true,
                label: 'Highlight Sync Period (days)',
                description: 'Number of days to look back for new highlights'
            },
            'highlightTitlePrefix': {
                value: 'Omnivore Highlights',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Highlight Note Title Prefix',
                description: 'Prefix for the title of highlight notes (followed by the date)'
            },
            'lastSyncDate': {
                value: '',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: false,
                label: 'Last Sync Date'
            },
            'syncedArticles': {
                value: '[]',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: false,
                label: 'Synced Articles'
            },
            'syncedHighlights': {
                value: '{}',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: false,
                label: 'Synced Highlights',
                description: 'Internal use: Stores information about synced highlights'
            },
            'logLevel': {
                value: LogLevel.ErrorsAndWarnings,
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: true,
                label: 'Log Level',
                description: 'Set the level of logging detail',
                isEnum: true,
                options: {
                    [LogLevel.ErrorOnly]: 'Errors only',
                    [LogLevel.ErrorsAndWarnings]: 'Errors and Warnings',
                    [LogLevel.Debug]: 'Debug (verbose)'
                }
            },
        });

        await joplin.commands.register({
            name: 'resetOmnivoreSyncData',
            label: 'Reset Omnivore Sync Data',
            execute: async () => {
                const result = await joplin.views.dialogs.showMessageBox('Are you sure you want to reset the Omnivore sync data? This will clear the last sync date, all synced item IDs, and synced highlights. The next sync will fetch all articles and highlights again.\n\nPress OK to confirm, or Cancel to abort.');

                if (result === 0) { // User clicked 'OK'
                    await joplin.settings.setValue('lastSyncDate', '');
                    await joplin.settings.setValue('syncedArticles', '[]');
                    await joplin.settings.setValue('syncedHighlights', '{}');
                    await logger.debug('Omnivore sync data has been reset.');
                    await joplin.views.dialogs.showMessageBox('Omnivore sync data has been reset. The next sync will fetch all articles and highlights.');
                } else {
                    await logger.debug('Reset operation cancelled by user.');
                }
            }
        });

        await joplin.commands.register({
            name: 'syncOmnivoreArticles',
            label: 'Sync Omnivore Articles',
            execute: async () => {
                const apiKey = await joplin.settings.value('omnivoreApiKey');
                if (!apiKey) {
                    await logger.error('Omnivore API key not set. Please set your API key in the plugin settings.');
                    return;
                }
                const client = new OmnivoreClient({ apiKey, baseUrl: 'https://api-prod.omnivore.app' });
                await performSync(client);
            },
        });

        await joplin.views.menuItems.create('syncOmnivoreArticlesMenuItem', 'syncOmnivoreArticles', MenuItemLocation.Tools);
        await joplin.views.menuItems.create('resetOmnivoreSyncDataMenuItem', 'resetOmnivoreSyncData', MenuItemLocation.Tools);

        const setupScheduledSync = async () => {
            const interval = await joplin.settings.value('syncInterval');
            if (interval > 0) {
                setInterval(async () => {
                    const apiKey = await joplin.settings.value('omnivoreApiKey');
                    if (apiKey) {
                        const client = new OmnivoreClient({ apiKey, baseUrl: 'https://api-prod.omnivore.app' });
                        await performSync(client);
                    }
                }, interval * 60 * 1000);
            }
        };

        await setupScheduledSync();
        await joplin.settings.onChange(async () => {
            await setupScheduledSync();
        });

        await logger.debug('Omnivore Sync plugin started');
    }
});

async function performSync(client: OmnivoreClient) {
    await logger.info('Starting Omnivore sync');
    let lastSyncDate = await joplin.settings.value('lastSyncDate');
    const syncType = await joplin.settings.value('syncType') as SyncType;
    const highlightSyncPeriod = await joplin.settings.value('highlightSyncPeriod');

    if (!lastSyncDate) {
        lastSyncDate = new Date(0).toISOString();
        await logger.info('Last sync date was reset or not set. Using earliest possible date.');
    }

    await logger.debug(`Last sync date: ${lastSyncDate}`);
    await logger.debug(`Sync type: ${syncType}`);

    const articleLabels = (await joplin.settings.value('articleLabels') as string).split(',').map(label => label.trim()).filter(Boolean);
    const highlightLabels = (await joplin.settings.value('highlightLabels') as string).split(',').map(label => label.trim()).filter(Boolean);

    try {
        let newLastSyncDate = lastSyncDate;

        if (syncType === SyncType.All || syncType === SyncType.Articles) {
            const articleResult = await syncArticles(client, turndownService, lastSyncDate, articleLabels);
            newLastSyncDate = articleResult.newLastSyncDate;
            await joplin.settings.setValue('syncedArticles', JSON.stringify(articleResult.syncedArticles));
        }

        if (syncType === SyncType.All || syncType === SyncType.Highlights) {
            const highlightResult = await syncHighlights(client, turndownService, lastSyncDate, highlightSyncPeriod, highlightLabels);
            if (new Date(highlightResult.newLastSyncDate) > new Date(newLastSyncDate)) {
                newLastSyncDate = highlightResult.newLastSyncDate;
            }
            await joplin.settings.setValue('syncedHighlights', JSON.stringify(highlightResult.syncedHighlights));
        }

        await cleanupHighlightNotes();

        const syncedArticles = JSON.parse(await joplin.settings.value('syncedArticles') || '[]');
        const cleanedArticles = await cleanupOldArticles(syncedArticles);
        await joplin.settings.setValue('syncedArticles', JSON.stringify(cleanedArticles));

        await joplin.settings.setValue('lastSyncDate', newLastSyncDate);
        await logger.info(`Sync completed. New last sync date: ${newLastSyncDate}`);
    } catch (error) {
        await logger.error(`Error during sync: ${error.message}`);
    }
}
