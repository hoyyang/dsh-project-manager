/**
 * v119：任务树的纯逻辑（不碰 DOM）——客户端拖动 / 键盘改层级、服务端校验都用这一份。
 * 规则：子任务最多一层；有子任务的任务不能再成为别人的子任务；只能在「已完成 / 未完成」同一区内移动
 * （跨区会造出「已完成父任务带未完成子任务」这种矛盾）。
 */
export interface TaskLike {
    id?: string;
    text: string;
    done: boolean;
    subs?: TaskLike[];
}
export interface TaskHit<T> {
    t: T;
    list: T[];
    i: number;
    p: T | null;
}
/** 在任务树里找一条（顶层或子任务），同时给出它所在的数组与它的父任务。 */
export declare function tFindIn<T extends TaskLike>(l: T[], id: string): TaskHit<T> | null;
export type TaskMoveMode = 'nest' | 'outdent' | 'order';
/** 一次拖放 / 键盘改层级的结果：{ msg } = 成功（msg 为空表示没变化），{ err } = 拒绝并说明原因。 */
export type TaskMoveResult = {
    msg: string;
    err?: undefined;
} | {
    msg?: undefined;
    err: string;
};
/**
 * 就地改 list（调用方自己深拷贝）：nest = 变成 tid 的最后一个子任务；outdent = 子任务回顶层（before 决定插前 / 后）；
 * order = 同层换位（before 决定插前 / 后）。
 */
export declare function tMove<T extends TaskLike>(list: T[], op: {
    id: string;
    tid: string;
    mode: TaskMoveMode;
    before: boolean;
    sid?: string;
}): TaskMoveResult;
