export interface Dict {
    v: string;
    dict: Record<string, string>; /** 该语言的键空间总数（覆盖率分母；老词典没有这一项 */
    total?: number;
}
/** v185：可用的界面词典语言（zh 是源语言，不需要词典）。 */
export type DictLang = 'en' | 'ru';
export declare const DICT_LANGS: readonly DictLang[];
/** 读一份词典（成功后再调直接给缓存；失败不缓存失败结果 —— 重装 / 重新构建后重试时才可能变好）。 */
export declare function loadDict(lang?: DictLang): Dict | null;
