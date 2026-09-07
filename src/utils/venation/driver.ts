import type { Logger } from 'log4js';
import type { ServerResponse } from 'node:http';
import http from 'node:http';

import { VenDriver } from '../interface';
import { IRequest, IResponse } from './transport';

export class VenNodeDriver extends VenDriver {
	public readonly server;
	public constructor(private readonly logger: Logger) {
		super();
		this.server = http.createServer({
			IncomingMessage: IRequest,
			ServerResponse: IResponse as typeof ServerResponse,
		});
	}

	public listen(host: string, port: number) {
		this.server.on('listening', () => {
			this.logger.info(`server is listening on http://${host}:${port}`);
		});

		this.server.listen(port, host);
	}

	public onRequest(cb: (req: IRequest, res: IResponse) => void) {
		this.server.on('request', (req, res) => {
			cb(req, res as IResponse);
		});
	}
}
