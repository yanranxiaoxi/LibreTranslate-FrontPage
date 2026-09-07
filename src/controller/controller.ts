export class Controller {
	public constructor() {
		this.bindMethods();
	}

	private bindMethods() {
		Object.getOwnPropertyNames(Object.getPrototypeOf(this))
			.filter(method => typeof (this as any)[method] === 'function')
			.forEach((method) => {
				(this as any)[method] = (this as any)[method].bind(this);
			});
	}
}
