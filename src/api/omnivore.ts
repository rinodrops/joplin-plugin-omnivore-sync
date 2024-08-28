// api/omnivore.ts
// Aug 2024 by Rino, eMotionGraphics Inc.

import { Omnivore, Item, Highlight as OmnivoreHighlight } from '@omnivore-app/api';
import { Article, Highlight, OmnivoreClientConfig } from '../types';
import { logger } from '../logger';

export class OmnivoreClient {
    private client: Omnivore;

    constructor(config: OmnivoreClientConfig) {
        this.client = new Omnivore(config);
    }

    async getArticles(since: string, labels: string[] = []): Promise < Article[] > {
        try {
            const sinceDate = since ? new Date(since).toISOString().split('T')[0] : '';
            await logger.debug(`Fetching articles since: ${sinceDate || 'the beginning'}`);

            let query = `${sinceDate ? `saved:${sinceDate}..*` : ''} sort:saved-asc`;
            if (labels.length > 0) {
                const labelQuery = labels.map(label => `label:"${label}"`).join(' OR ');
                query += ` (${labelQuery})`;
            }
            await logger.debug(`Using query: ${query}`);

            let allArticles: Article[] = [];
            let hasNextPage = true;
            let after: string | null = null;

            while (hasNextPage) {
                const response = await this.client.items.search({
                    after: after ? parseInt(after) : undefined,
                    first: 100,
                    query: query,
                    includeContent: true
                });

                if (!response.edges || response.edges.length === 0) {
                    break;
                }

                allArticles = allArticles.concat(response.edges.map(edge => {
                    const item = edge.node as Item;
                    return {
                        ...item,
                        hash: (item as any).hash,
                        createdAt: (item as any).createdAt || item.savedAt,
                        readingProgressAnchorIndex: (item as any).readingProgressAnchorIndex,
                        folder: (item as any).folder
                    } as Article;
                }));

                hasNextPage = response.pageInfo.hasNextPage;
                after = response.pageInfo.endCursor;

                await logger.debug(`Fetched ${allArticles.length} articles so far`);
            }

            await logger.debug(`Total articles fetched: ${allArticles.length}`);
            return allArticles;
        } catch (error) {
            await logger.error(`Error fetching articles from Omnivore: ${error.message}`);
            throw error;
        }
    }

    async getHighlights(since: string, syncPeriod: number, labels: string[] = []): Promise<Highlight[]> {
        try {
            const sinceDate = new Date(since);
        const oldestDate = new Date();
        oldestDate.setDate(oldestDate.getDate() - syncPeriod);

        const queryDate = oldestDate < sinceDate ? oldestDate : sinceDate;
        const formattedDate = queryDate.toISOString().split('T')[0];

        await logger.debug(`Fetching highlights for articles saved since: ${formattedDate}`);

        let query = `saved:${formattedDate}..* sort:saved-asc has:highlights`;
        if (labels.length > 0) {
            const labelQuery = labels.map(label => `label:"${label}"`).join(' OR ');
            query += ` (${labelQuery})`;
        }
        await logger.debug(`Using query: ${query}`);


            let allHighlights: Highlight[] = [];
            let hasNextPage = true;
            let after: string | null = null;

            while (hasNextPage) {
                const response = await this.client.items.search({
                    after: after ? parseInt(after) : undefined,
                    first: 100,
                    query: query,
                    includeContent: true
                });

                if (!response.edges || response.edges.length === 0) {
                    break;
                }

                const highlights = response.edges.flatMap(edge => {
                    if (edge.node.highlights) {
                        return edge.node.highlights.map(highlight => {
                            const omnivoreHighlight = highlight as OmnivoreHighlight;
                            return {
                                ...omnivoreHighlight,
                                shortId: (omnivoreHighlight as any).shortId,
                                createdAt: (omnivoreHighlight as any).createdAt || new Date().toISOString(),
                                article: {
                                    id: edge.node.id,
                                    title: edge.node.title,
                                    url: edge.node.url,
                                    originalArticleUrl: edge.node.originalArticleUrl,
                                    savedAt: edge.node.savedAt,
                                    author: edge.node.author,
                                    publishedAt: edge.node.publishedAt,
                                    slug: edge.node.slug
                                }
                            } as Highlight;
                        });
                    }
                    return [];
                });

                allHighlights = allHighlights.concat(highlights);

                hasNextPage = response.pageInfo.hasNextPage;
                after = response.pageInfo.endCursor;

                await logger.debug(`Fetched ${allHighlights.length} highlights so far`);
            }

            await logger.debug(`Total highlights fetched: ${allHighlights.length}`);
            return allHighlights;
        } catch (error) {
            await logger.error(`Error fetching highlights from Omnivore: ${error.message}`);
            throw error;
        }
    }
}
