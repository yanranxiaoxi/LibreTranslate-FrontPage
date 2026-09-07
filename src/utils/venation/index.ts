import type { Logger } from 'winston';
import type { VenNodeDriver } from './driver';
import { Router } from '../router';

export class Venation extends Router {
	public constructor(public readonly logger: Logger) {
		super();
	}

	public addDriver(driver: VenNodeDriver) {
		driver.onRequest(async (req, res) => {
			const ctx: any = {
				req,
				res,
				method: req.method ?? '',
				requestParams: {},
				requestFiles: {},
				getQuery: {},
				routerParams: {},
				logger: this.logger,
			};
			const path = req.url ? req.url.split('?')[0] : '';
			try {
				const routeIndex: Array<number> = [];
				const matched = this.checkRoute(ctx, path === '/' ? '' : path, routeIndex);
				if (!matched) {
					res.statusCode = 404;
					res.end('404 Not Found !!!');
				}
				else {
					await this.run(ctx as any, path === '/' ? '' : path, routeIndex);
					res.end();
				}
			}
			catch (ex) {
				ctx.logger.error(ex);
				res.statusCode = 500;
				res.end('500 Internal Server Error !!!');
			}
		});
	}
}
