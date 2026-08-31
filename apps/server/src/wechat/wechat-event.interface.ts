export type WechatEventType = 'subscribe' | 'scan' | 'other';

export interface WechatEventResult {
  eventType: WechatEventType;
  openid: string;
  sceneValue?: number;
}

export interface IWechatEventService {
  parseEvent(xmlBody: string): WechatEventResult;
}

export const WECHAT_EVENT_SERVICE = 'WECHAT_EVENT_SERVICE';
