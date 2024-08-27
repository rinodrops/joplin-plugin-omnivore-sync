// src/types.ts: Type definition
// Aug 2024 by Rino, eMotionGraphics Inc.

import { Item as OmnivoreItem, Highlight as OmnivoreHighlight } from '@omnivore-app/api';

export interface Article extends OmnivoreItem {
    hash?: string;
    createdAt?: string;
    readingProgressAnchorIndex?: number;
    folder?: string;
}

export interface Highlight extends OmnivoreHighlight {
    shortId?: string;
    createdAt?: string;
    article: {
        id: string;
        title: string;
        url: string;
        originalArticleUrl?: string;
        savedAt: string;
        author?: string;
        publishedAt?: string;
        slug?: string;
    };
}

export interface Label {
    id: string;
    name: string;
    color: string;
    description?: string;
}

export type ID = string;

export interface SyncedArticle {
    id: string;
    savedAt: string;
}

export interface SyncedHighlight {
    id: string;
    createdAt: string;
}

export enum SyncType {
    All = 'all',
    Articles = 'articles',
    Highlights = 'highlights'
}

export interface OmnivoreClientConfig {
    apiKey: string;
    baseUrl: string;
}

export interface Note {
    id: string;
    title: string;
    body: string;
}
