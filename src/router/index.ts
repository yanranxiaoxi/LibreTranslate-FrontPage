import type { Venation } from '../utils/venation';
import main from '../controller/main.controller';
import api from '../middleware/api.middleware';
import parameterMid from '../middleware/parameter.middleware';
import traceMid from '../middleware/trace.middleware';
import testRouter from './test';

export default async (ven: Venation) => {
	await ven.router('', traceMid, api(), parameterMid).then((sub) => {
		// 基础接口
		sub.get('', main.get);

		// 测试接口
		sub.router('/test').then(testRouter);
	});
};
