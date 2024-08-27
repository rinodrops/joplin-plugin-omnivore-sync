# Joplin Omnivore Sync Plugin

This plugin allows you to sync your [Omnivore](https://omnivore.app/) articles and highlights directly into [Joplin](https://joplinapp.org/), a free, open-source note taking and to-do application.

## Features

- Sync articles from Omnivore to Joplin
- Sync highlights and annotations from Omnivore to Joplin
- Choose between syncing all content, only articles, or only highlights
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
   - Timezone ("local" for system timezone)
   - Highlight Sync Period (days)
   - Highlight Note Title Prefix (followed by the date)

## Usage

### Manual Sync

You can manually trigger a sync by going to Tools > Sync Omnivore Articles

### Automatic Sync

If you've set a sync interval, the plugin will automatically sync at the specified interval.

### Reset Sync Data

If you need to reset the sync data (e.g., to re-sync all content), go to Tools > Reset Omnivore Sync Data

## Templates

The plugin offers three predefined templates for formatting highlights:

1. Default: Includes a full markdown layout with the article title, quote, source link, creation date, and annotation
2. Minimal: Includes only the quote, annotation (if any), and a link to the source

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. If you encounter any problems or have any questions, please open an issue on this GitHub repository.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
