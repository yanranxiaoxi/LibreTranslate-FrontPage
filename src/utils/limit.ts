/**
 * 进程内限流工具
 *
 * 三个项目共用同一套实现，保持行为一致。
 * 仅做单实例保护：多副本部署时需在反向代理层再加全局限流。
 */

/** 简易并发闸门：超过上限直接拒绝，避免上游连接被占满 */
export class ConcurrencyGate {
	private active = 0;

	public constructor(private readonly max: number) {}

	/** 申请一个并发名额；已达上限返回 false */
	public tryAcquire(): boolean {
		if (this.active >= this.max) {
			return false;
		}
		this.active++;
		return true;
	}

	/** 归还并发名额 */
	public release(): void {
		if (this.active > 0) {
			this.active--;
		}
	}
}

interface BucketState {
	/** 当前可用令牌数 */
	tokens: number;
	/** 上次补充时间（毫秒） */
	updatedAt: number;
}

/**
 * 令牌桶限流器（按 key 隔离）
 *
 * 桶表有上限，配合惰性清理，避免被大量伪造 key 撑爆内存。
 */
export class TokenBucketLimiter {
	private readonly buckets = new Map<string, BucketState>();

	/**
	 * @param capacity - 突发上限（桶容量）
	 * @param refillPerSecond - 每秒补充的令牌数
	 * @param maxKeys - 桶表上限
	 */
	public constructor(
		private readonly capacity: number,
		private readonly refillPerSecond: number,
		private readonly maxKeys = 10_000,
	) {}

	/** 取一枚令牌；无可用令牌返回 false */
	public take(key: string, now = Date.now()): boolean {
		let state = this.buckets.get(key);
		if (!state) {
			if (this.buckets.size >= this.maxKeys) {
				this.prune(now);
				if (this.buckets.size >= this.maxKeys) {
					// 表仍满：拒绝新 key，宁可误伤也不让内存无界增长
					return false;
				}
			}
			state = { tokens: this.capacity, updatedAt: now };
			this.buckets.set(key, state);
		}
		else {
			const elapsed = Math.max(0, now - state.updatedAt) / 1000;
			state.tokens = Math.min(this.capacity, state.tokens + elapsed * this.refillPerSecond);
			state.updatedAt = now;
		}

		if (state.tokens < 1) {
			return false;
		}
		state.tokens -= 1;
		return true;
	}

	/** 清空所有桶（测试用） */
	public reset(): void {
		this.buckets.clear();
	}

	/** 删除已回满的桶：这些 key 的状态与新建等价，可以安全丢弃 */
	private prune(now: number): void {
		const idleMs = (this.capacity / this.refillPerSecond) * 1000;
		for (const [key, state] of this.buckets) {
			if (now - state.updatedAt >= idleMs) {
				this.buckets.delete(key);
			}
		}
	}
}
