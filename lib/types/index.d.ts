import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-project-manager";
export interface Config {
    dataDir: string;
    aiRoot: string;
    hubTitle: string;
    projectSessionMode: 'danger-full-access' | 'inherit';
    memoryMaxBytes: number;
}
export declare const Config: z<Config>;
type Session = {
    id: string;
    header: {
        cwd?: string;
        origin?: string;
    };
};
type Workspace = {
    id: string;
    path: string;
    title: string;
};
type HostCtx = Context & {
    webServer: {
        register(r: unknown): () => void;
    };
    tools: {
        register(t: unknown): void;
    };
    workspaceRegistry: {
        create(path: string, title?: string): Promise<Workspace>;
        list(): Workspace[];
        archivedSessionIds?: readonly string[];
        unarchiveSession?: (id: string) => Promise<void>;
        get(id: string): Workspace | undefined;
        delete(id: string): Promise<boolean>;
        insertBefore(id: string, beforeId?: string): Promise<readonly string[]>;
    };
    sessions: {
        get(id: string): Session | undefined;
    };
    permissionPresets: {
        set(session: Session, name: string): void;
    };
    sessionTitle: {
        rename(session: Session, title: string): unknown;
    };
    systemPrompt: {
        context(c: {
            name: string;
            order: number;
            text: (c: {
                agent?: {
                    session: {
                        id: string;
                    };
                };
            }) => string;
        }): () => void;
    };
    get(name: string): unknown;
    logger?: (name: string) => {
        info(...a: unknown[]): void;
        warn(...a: unknown[]): void;
    };
};
export declare const inject: string[];
export declare function apply(ctx: HostCtx, config: Config): void;
export {};
