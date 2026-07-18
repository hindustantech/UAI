export class BaseProvider {
  async send(payload) {
    throw new Error(`send() not implemented by ${this.constructor.name}`);
  }

  async validate(payload) {
    throw new Error(`validate() not implemented by ${this.constructor.name}`);
  }

  getChannelName() {
    throw new Error(`getChannelName() not implemented by ${this.constructor.name}`);
  }

  isAvailable() {
    return true;
  }
}
