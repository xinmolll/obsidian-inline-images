export class Notice {
  constructor(text: string) { (globalThis as any).__notices.push(text); }
  hide() {}
}
export class Plugin {
  events = new Map(); commands: any[] = []; extensions: any[] = [];
  ribbons: any[] = [];
  constructor(public app: any) {}
  async loadData() { return {}; }
  async saveData(_data: any) {}
  registerEvent(event: any) { this.events.set(event.name, event.callback); }
  registerEditorExtension(extension: any) { this.extensions.push(extension); }
  addCommand(command: any) { this.commands.push(command); }
  addRibbonIcon(icon: string, title: string, callback: any) { this.ribbons.push({ icon, title, callback }); }
  addSettingTab(_tab: any) {}
  registerMarkdownCodeBlockProcessor(_language: string, _processor: any) {}
}
export class PluginSettingTab { constructor(_app: any, _plugin: any) {} }
export class Setting {}
export class MarkdownView {}
export class MarkdownRenderChild { constructor(_element: any) {} register(_cleanup: any) {} }
