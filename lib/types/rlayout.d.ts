/** v134：卡片详情 × DSH 右侧栏（文件预览 / 浏览器 / 终端）的宽度分配。纯函数：client board.ts rlLay 调用，test/v134 单测。
    宿主 frame = 三列 grid「左栏 | 中列 minmax(400px,1fr) | 右侧栏轨道」，右侧栏面板 absolute 贴 frame 右边。
    A = 窗口 − 左栏（= 中列 + 右侧栏轨道），Rt = 宿主右侧栏轨道宽，hostW = 宿主给面板的宽，D0 = 详情想要的宽度。
    详情永远最右；右侧栏面板挪到详情左边（right = D、width = Rv），中列补差额 pad = D + Rv − Rt。 */
export declare const CMIN = 400, RMIN = 300, DMIN = 360;
export type RlIn = {
    A: number;
    Rt: number;
    hostW: number;
    D0: number;
    ratio: number | null;
    drag: {
        rv0: number;
        dx: number;
    } | null;
    last: 'detail' | 'rightbar';
    full: boolean;
};
export type RlOut = {
    mode: 'full';
    rbR: number;
} | {
    mode: 'compact-detail';
    D: number;
    pad: number;
} | {
    mode: 'compact-rightbar';
} | {
    mode: 'pair';
    D: number;
    Rv: number;
    pad: number;
    ratio: number;
};
export declare function rlPlan(i: RlIn): RlOut;
export type ColKey = 'tp' | 'cd' | 'rbx' | 'ap';
export declare const COL_ORDER: ColKey[];
export declare const COL_MIN: Record<ColKey, number>;
export declare const TAB_W = 44;
export type ColIn = {
    k: ColKey;
    want: number;
    at: number;
};
export type ColOut = {
    cols: Array<{
        k: ColKey;
        w: number;
        right: number;
    }>;
    away: ColKey[];
    tabs: number;
    total: number;
};
export declare function colsPlan(avail: number, open: ColIn[], cmin?: number): ColOut;
