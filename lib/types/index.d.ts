import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-project-manager";
export interface Config {
    dataDir: string;
    aiRoot: string;
    hubTitle: string;
    projectSessionMode: 'danger-full-access' | 'inherit';
    memoryMaxBytes: number;
    landfill: boolean;
    agentsHome: string;
}
export declare const Config: z<Config>;
type Session = {
    id: string;
    header: {
        cwd?: string;
        origin?: string;
        parentSession?: string;
    };
};
type Msg = {
    id: string;
    role: 'user';
    content: Array<{
        type: 'text';
        text: string;
    }>;
    source: {
        kind: string;
        form?: string;
    };
};
type Ev = {
    type: string;
    data?: unknown;
};
type Agent = {
    id?: string;
    session?: {
        id?: string;
        header?: {
            cwd?: string;
        };
        seq?: number;
        eventAt?(seq: number): Ev | undefined;
    };
    steer?(m: Msg): void;
};
type Workspace = {
    id: string;
    path: string;
    title: string;
    setTitle?(title: string): Promise<void>;
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
    skills?: {
        register(s: {
            name: string;
            description: string;
            content: string;
            source: string;
            path?: string;
            resourceBase?: {
                kind: 'directory';
                path: string;
            };
        }): () => void;
    };
    commands?: {
        register(c: {
            name: string;
            description: string;
            input?: {
                hint?: string;
            };
            handler: (i: {
                rawInput: string;
                agent?: Agent;
            }) => {
                kind: 'success' | 'error';
                text: string;
            };
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
