# Replay Lab 插件：自己写演出效果

想要内置之外的效果？比如樱花、雨、故障闪烁、自己设计的转场，或者老胶片滤镜，都可以写成插件，放进工程文件夹里使用。

## 放在哪里

把 `.js` 文件放进工程文件夹的 `plugins/` 里：

```
我的工程/
  project.replaylab.json
  plugins/
    樱花.js
    故障转场.js
```

打开工程时，Replay Lab 会列出这些插件，**等你勾选同意后才会运行**。插件是代码，只启用你自己写的或者你信任的人给的。文件一旦改动，会再问你一次。

也可以在「素材 → 插件」里点 **新建示例插件**，生成一个可以照着改的示例：`plugins/示例-爱心飘落.js`。

## 最小的插件

```js
/** 樱花：/sakura [数量] [秒数] */
export default function (api) {
  api.registerCommand({
    name: 'sakura',
    aliases: ['樱花'],
    usage: '/sakura [数量] [秒数]',
    template: '/sakura 40 4',
    layer: 'world',          // world：和角色在同一层，会被滤镜染色；screen：盖在舞台上（默认）；top：盖在所有东西上，包括对话框
    defaultDuration: 4,
    parse(args) {            // 可选：检查写法，决定持续多久
      const seconds = Number(args[1] ?? 4);
      if (!(seconds > 0)) return { error: '秒数要大于 0' };
      return { duration: seconds /*, blocking: true  让台本停下来等它播完 */ };
    },
    draw(ctx, info) {        // 每一帧都会调用
      for (let i = 0; i < (Number(info.args[0]) || 40); i++) {
        const x = info.random(i) * info.width;
        const y = (info.random(i + 1) * info.height + info.time * 80) % info.height;
        ctx.fillStyle = '#ffc6d9';
        ctx.fillRect(x, y, 6, 6);
      }
    }
  });
}
```

写进台本：`/sakura 60 5` 或 `/樱花 60 5`。不让台本停顿的效果，会一直持续到秒数结束，中间跨几句台词都可以。「动画」施工区里也会多出这个指令的快捷按钮。

## `draw(ctx, info)` 能拿到什么

| 字段 | 说明 |
|---|---|
| `info.time` | 效果开始后过了几秒 |
| `info.duration` / `info.progress` | 总时长；进度，从 0 到 1 |
| `info.width` / `info.height` | 画布大小 |
| `info.args` | 指令后面写的词，比如 `/sakura 60 5` 得到 `['60', '5']` |
| `info.heads` | `world` 层专有：每个在场角色头顶的位置 `{ 名字: { x, y, h } }`，可以拿来做头顶特效 |
| `info.speakerName` / `info.text` | 当前这句的说话人和台词 |
| `info.random(n)` | 固定的伪随机数（0 到 1），**要用它代替 `Math.random()`** |

**一条硬规则**：同一个时刻必须画出同一帧。所以只能用 `info` 里的数值和 `info.random` 来决定画面，不要依赖 `Math.random()`、`Date.now()`，也不要跨帧累积状态。这样拖进度条、预览和导出视频才会完全一致。

## 转场与滤镜

```js
api.registerTransition({
  name: 'glitch', aliases: ['故障'],
  // progress 从 0 到 1；把 previous（上一句最后一帧）里还没被揭开的部分画出来
  cover(ctx, progress, width, height, previous) { /* ... */ }
});
api.registerFilter({
  name: '老电视',
  css: 'contrast(1.25) saturate(0.6)',          // 给背景和角色调色
  overlay(ctx, width, height, time) { /* 扫描线、噪点…… */ }
});
```

用法：`/transition glitch 0.8`，`/filter 老电视`（`/filter 无` 关闭）。插件转场也会出现在单句属性的「转场」下拉框里。

## 工具函数

`api.util.random(n)`、`api.util.clamp(v, lo, hi)`、`api.util.easeOut(t)`、`api.util.easeInOut(t)`。

## 限制

- **安全**：插件和 Replay Lab 跑在同一个页面里，理论上 Replay Lab 能做的事它都能做，包括读写当前打开的工程、联网。所以它不是沙盒，安全只靠"运行前先问你"这一道关。Replay Lab 只会加载你勾选过的、内容没变过的文件。来路不明的插件请不要启用。
- 单个插件文件不能超过 512 KB，一个工程最多 32 个。
- 插件不能覆盖内置指令，比如 `/shake`、`/bg`。
- 插件画图时出错，只会跳过这个插件，不会影响整帧，错误会显示在「插件」列表里。
- 导出的可交互网页播放器暂时不带插件，视频导出带。
