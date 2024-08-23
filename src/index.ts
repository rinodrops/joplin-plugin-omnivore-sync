import joplin from 'api';
import { MenuItemLocation, SettingItemType } from 'api/types';
import { OmnivoreClient } from './omnivoreClient';
import { syncArticles } from './sync';
import TurndownService from 'turndown';

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

// Custom rule to handle headings
turndownService.addRule('heading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: function (content, node, options) {
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
            'lastSyncDate': {
                value: '',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: false,
                label: 'Last Sync Date'
            },
            'syncedItems': {
                value: '[]',
                type: SettingItemType.String,
                section: 'omnivoreSync',
                public: false,
                label: 'Synced Items'
            },
            'syncType': {
                value: 'all',
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
                value: '0',
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
                    detailed: 'Detailed'
                }
            }
        });

        await joplin.commands.register({
            name: 'resetOmnivoreSyncData',
            label: 'Reset Omnivore Sync Data',
            execute: async () => {
                const result = await joplin.views.dialogs.showMessageBox('Are you sure you want to reset the Omnivore sync data? This will clear the last sync date and all synced item IDs. The next sync will fetch all articles again.\n\nPress OK to confirm, or Cancel to abort.');

                if (result === 0) { // User clicked 'OK'
                    await joplin.settings.setValue('lastSyncDate', '');
                    await joplin.settings.setValue('syncedItems', '[]');
                    console.log('Omnivore sync data has been reset.');
                    await joplin.views.dialogs.showMessageBox('Omnivore sync data has been reset. The next sync will fetch all articles.');
                } else {
                    console.log('Reset operation cancelled by user.');
                }
            }
        });

        await joplin.commands.register({
            name: 'syncOmnivoreArticles',
            label: 'Sync Omnivore Articles',
            execute: async () => {
                const apiKey = await joplin.settings.value('omnivoreApiKey');
                if (!apiKey) {
                    console.error('Omnivore API key not set. Please set your API key in the plugin settings.');
                    return;
                }
                const client = new OmnivoreClient(apiKey);
                await syncArticles(client, turndownService);
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
                        const client = new OmnivoreClient(apiKey);
                        await syncArticles(client, turndownService);
                    }
                }, interval * 60 * 1000);
            }
        };

        await setupScheduledSync();
        await joplin.settings.onChange(async () => {
            await setupScheduledSync();
        });

        console.log('Omnivore Sync plugin started');
    }
});
