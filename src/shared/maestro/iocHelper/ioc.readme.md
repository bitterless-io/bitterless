# IoC Helper

基于 `inversify` 的轻量依赖注入工具，用于将一个大模块拆分为 Controller + 多个 Service 子模块。

## 核心 API

- `iocHelper.bind({ controller, services })` — 创建容器，注入 services 到 controller，返回 controller 实例。
- `CommonService<S>` — Service 基类，通过 `setState(state)` 获取 controller 的状态引用。

## 最小示例

```ts
// 1. 定义 Service 子模块
@injectable()
export class UserProfileService extends CommonService<UserController> {
  updateName(name: string) {
    this._state.name = name;
  }
}

// 2. 定义 Controller（主模块）
@injectable()
export class UserController {
  name = '';
  loading = false;

  constructor(
    @inject(Symbol.for(UserProfileService.name))
    public readonly profileService: UserProfileService,
  ) {
    this.profileService.setState(this);
  }
}

// 3. 绑定并导出响应式 store
const state = iocHelper.bind({
  controller: UserController,
  services: [UserProfileService],
});
export const userStore = reactive<UserController>(state);
```

## 要点

- **Controller** 持有状态字段，通过构造函数 `@inject` 注入所有 Service。
- **Service** 继承 `CommonService<Controller>`，构造后由 Controller 调用 `setState(this)` 传入状态引用，之后通过 `this._state` 读写 Controller 状态。
- 当模块逻辑过大时，按职责拆分为多个 Service（如 `CreditService`、`BillService`），各自管理一部分业务逻辑，Controller 只做状态定义和 Service 编排。
