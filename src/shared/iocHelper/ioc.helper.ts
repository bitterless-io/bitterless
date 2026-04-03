import 'reflect-metadata';
import {Container,inject,injectable} from "inversify";

const bind = (params: {
  controller: new (...args: any[]) => any,
  services: (new (...args: any[]) => any)[]
}) => {
  let container = new Container();
  const CT = params.controller;
  // @ts-ignore
  container.bind<CT>(Symbol.for(CT.name)).to(CT);
  for (let ST of params.services){
    // @ts-ignore
    container.bind<ST>(Symbol.for(ST.name)).to(ST)
  }
  // @ts-ignore
  return container.get<CT>(Symbol.for(CT.name));

}
export const iocHelper = {
  bind,
}
@injectable()
export class CommonService<S> {
  _state!: S;
  setState(state: S) {
    this._state = state;
  }
}