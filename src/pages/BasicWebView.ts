// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as fs from 'fs-extra';
import {
  Disposable,
  ExtensionContext,
  Uri,
  ViewColumn,
  WebviewOptions,
  WebviewPanel,
  WebviewPanelOptions,
  window,
} from 'vscode';
import { Constants } from '../Constants';
import { Telemetry } from '../TelemetryClient';

export interface IWebViewConfig {
  path: string;
  showOnStartup: string;
  title: string;
  viewType: string;
}

export abstract class BasicWebView {
  protected panel?: WebviewPanel;
  protected readonly context: ExtensionContext;
  protected readonly disposables: Disposable[];
  protected readonly options: WebviewPanelOptions & WebviewOptions;
  protected readonly rootPath: Uri;

  protected abstract config: IWebViewConfig;

  private startShowDate: number;

  protected constructor(context: ExtensionContext) {
    this.context = context;
    this.startShowDate = 0;
    this.disposables = [];
    this.rootPath = Uri.file(this.context.asAbsolutePath('.'));
    this.options = {
      enableCommandUris: true,
      enableScripts: true,
      localResourceRoots: [ this.rootPath ],
      retainContextWhenHidden: true,
    };
  }

  public async checkAndShow(): Promise<void> {
    const showOnStartup = this.context.globalState.get(this.config.showOnStartup);
    if (showOnStartup === false) {
      return;
    }

    if (showOnStartup === undefined) {
      this.context.globalState.update(this.config.showOnStartup, await this.setShowOnStartupFlagAtFirstTime());
    }

    Telemetry.sendEvent(
      Constants.telemetryEvents.webPages.showWebPage,
      {
        trigger: 'auto',
        viewType: this.config.viewType,
      },
    );
    return this.createAndShow();
  }

  public async show() {
    Telemetry.sendEvent(
      Constants.telemetryEvents.webPages.showWebPage,
      {
        trigger: 'manual',
        viewType: this.config.viewType,
      },
    );
    return this.createAndShow();
  }

  protected async createAndShow(): Promise<void> {
    if (this.panel) {
      return this.panel.reveal(ViewColumn.One);
    }

    this.panel = window.createWebviewPanel(this.config.viewType, this.config.title, ViewColumn.One, this.options);
    this.startShowDate = new Date().getTime();

    this.panel.webview.html = await this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage((message) => this.receiveMessage(message), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  protected abstract async setShowOnStartupFlagAtFirstTime(): Promise<boolean>;

  protected async getHtmlForWebview(): Promise<string> {
    const rootPath = this.rootPath.with({scheme: 'vscode-resource'}).toString();
    const html = await fs.readFile(this.config.path, 'utf8');

    return html.replace(/{{root}}/g, rootPath);
  }

  protected async receiveMessage(message: {[key: string]: any}): Promise<void> {
    if (!this.panel) {
      return;
    }

    if (message.command === 'documentReady') {
      this.panel.webview.postMessage({
        command: 'showOnStartup',
        value: this.context.globalState.get(this.config.showOnStartup),
      });
    }

    if (message.command === 'toggleShowPage') {
      this.context.globalState.update(this.config.showOnStartup, message.value);
    }

    if (message.command === 'executeCommand' || message.command === 'openLink') {
      Telemetry.sendEvent(Constants.telemetryEvents.webPages.action, message);
    }
  }

  protected dispose(): void {
    if (this.panel) {
      this.panel.dispose();

      const duration = (new Date().getTime() - this.startShowDate) / 1000;
      this.startShowDate = 0;
      Telemetry.sendEvent(
        Constants.telemetryEvents.webPages.disposeWebPage,
        { viewType: this.config.viewType },
        { duration },
      );
    }

    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }

    this.panel = undefined;
  }
}
