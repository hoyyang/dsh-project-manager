export interface Dict {
    v: string;
    dict: Record<string, string>;
}
/** 读一次词典（成功后再调直接给缓存；失败不缓存失败结果 —— 点「重启后可用」重试时才可能变好）。 */
export declare function loadDict(): Dict | null;
