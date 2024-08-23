import { Omnivore } from '@omnivore-app/api'

export class OmnivoreClient {
  private client: Omnivore;

  constructor(apiKey: string) {
    this.client = new Omnivore({
      apiKey: apiKey,
      baseUrl: 'https://api-prod.omnivore.app',
    });
  }

  async getArticles(since: string): Promise<any[]> {
    try {
      const sinceDate = since ? new Date(since).toISOString().split('T')[0] : '';
      console.log(`Fetching articles since: ${sinceDate || 'the beginning'}`);

      const query = `${sinceDate ? `saved:${sinceDate}..*` : ''} sort:saved-asc`;
      console.log(`Using query: ${query}`);

      let allArticles: any[] = [];
      let hasNextPage = true;
      let after: string | null = null;

      while (hasNextPage) {
        const searchParams: any = {
          after: after ? parseInt(after) : undefined,
          first: 100,
          query: query,
          includeContent: true,
          includeLabels: true
        };

        // Add includeParsoidContent if it's supported by the API
        if (this.client.items.search.length > 1) {
          searchParams.includeParsoidContent = true;
        }

        const response = await this.client.items.search(searchParams);

        if (!response.edges || response.edges.length === 0) {
          break;
        }

        allArticles = allArticles.concat(response.edges.map(edge => edge.node));

        hasNextPage = response.pageInfo.hasNextPage;
        after = response.pageInfo.endCursor;

        console.log(`Fetched ${allArticles.length} articles so far`);
      }

      console.log(`Total articles fetched: ${allArticles.length}`);
      return allArticles;
    } catch (error) {
      console.error(`Error fetching articles from Omnivore: ${error.message}`);
      throw error;
    }
  }

  async getHighlights(since: string): Promise<any[]> {
    try {
      const sinceDate = since ? new Date(since).toISOString().split('T')[0] : '';
      console.log(`Fetching highlights since: ${sinceDate || 'the beginning'}`);

      const query = `${sinceDate ? `created:${sinceDate}..*` : ''} sort:created-asc has:highlights`;
      console.log(`Using query: ${query}`);

      let allHighlights: any[] = [];
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

        const highlights = response.edges.flatMap(edge =>
          edge.node.highlights ? edge.node.highlights.map(highlight => ({
            ...highlight,
            article: {
              title: edge.node.title,
              url: edge.node.url
            }
          })) : []
        );

        allHighlights = allHighlights.concat(highlights);

        hasNextPage = response.pageInfo.hasNextPage;
        after = response.pageInfo.endCursor;

        console.log(`Fetched ${allHighlights.length} highlights so far`);
      }

      console.log(`Total highlights fetched: ${allHighlights.length}`);
      return allHighlights;
    } catch (error) {
      console.error(`Error fetching highlights from Omnivore: ${error.message}`);
      throw error;
    }
  }
}
