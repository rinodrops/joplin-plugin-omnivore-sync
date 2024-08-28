# Joplin Omnivore Sync Plugin

This plugin allows you to sync your [Omnivore](https://omnivore.app/) articles and highlights directly into [Joplin](https://joplinapp.org/), a free, open-source note taking and to-do application.

## Features

- Sync articles from Omnivore to Joplin
- Sync highlights and annotations from Omnivore to Joplin
- Choose between syncing all content, only articles, or only highlights
- Filter articles and highlights by labels
- Group highlights by date or by article
- Customize the sync interval
- Select a target notebook for synced content
- Choose from predefined templates for highlight formatting

## Installation

### Marketplace

1. Open Joplin and navigate to Tools > Options > Plugins
2. Search for "Omnivore Sync" in the plugins marketplace
3. Click on Install
4. Restart Joplin to activate the plugin

### Manual

Copy `publish/jp.emotiongraphics.omnivore-sync.jpl` file to your `plugin` directory.
(It is `~/.config/joplin-desktop/plugins` on macOS)

## Configuration

After installation, you need to configure the plugin:

1. Go to Tools > Options > Omnivore Sync
2. Enter your Omnivore API Key (You can get this from your [Omnivore settings](https://omnivore.app/settings/api))
3. Choose your sync preferences:
   - Sync Type (All, Articles only, or Highlights only)
   - Sync Interval (in minutes, 0 for manual sync only)
   - Target Notebook (where synced content will be saved)
   - Highlight Template (choose from predefined templates)
   - Highlight Grouping (By Date or By Article)
   - Article Labels (comma-separated list of labels to filter articles)
   - Highlight Labels (comma-separated list of labels to filter highlights)
   - Timezone ("local" for system timezone)
   - Highlight Sync Period (days)
   - Highlight Note Title Prefix (followed by the date or article title)

## Usage

### Manual Sync

You can manually trigger a sync by going to Tools > Sync Omnivore Articles

### Automatic Sync

If you've set a sync interval, the plugin will automatically sync at the specified interval.

### Reset Sync Data

If you need to reset the sync data (e.g., to re-sync all content), go to Tools > Reset Omnivore Sync Data.
Note that it does not delete any notes on both Omnivore and Joplin. This menu just clear the plugin's internal data (the last sync date and all synced article/highlight IDs)

## Highlight Syncing Behavior

### By Date

- Highlights are grouped by the date they were created
- Within each date group, highlights are sorted chronologically (older on top)
- Highlights are further grouped by article within each date
- The note title is "{Prefix} {Date}"

### By Article

- All highlights from the same article within the sync period are grouped together
- Highlights are sorted by their position in the article
- The note title is "{Prefix} - {Article Title}"

## Templates

The plugin offers three predefined templates for formatting highlights:

1. Default: Includes a full markdown layout with the article title, highlights, annotations, creation date, and source link
2. Title, Highlight and Note
3. Highlight and Note: Suitable for "By Article"

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. If you encounter any problems or have any questions, please open an issue on [this GitHub repository](https://github.com/rinodrops/joplin-plugin-omnivore-sync). I also watch the Joplin Forum.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
