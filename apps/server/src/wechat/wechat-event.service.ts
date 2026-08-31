import { Injectable } from '@nestjs/common';
import { IWechatEventService, WechatEventResult } from './wechat-event.interface';

@Injectable()
export class WechatEventService implements IWechatEventService {
  parseEvent(xmlBody: string): WechatEventResult {
    const openid = this.readElement(xmlBody, 'FromUserName') || '';
    const messageType = (this.readElement(xmlBody, 'MsgType') || '').toLowerCase();
    const event = (this.readElement(xmlBody, 'Event') || '').toLowerCase();

    if (messageType !== 'event' || (event !== 'subscribe' && event !== 'scan')) {
      return { eventType: 'other', openid };
    }

    const eventKey = this.readElement(xmlBody, 'EventKey') || '';
    const sceneText = event === 'subscribe' ? eventKey.replace(/^qrscene_/i, '') : eventKey;
    const sceneValue = /^\d+$/.test(sceneText) ? Number(sceneText) : undefined;

    return {
      eventType: event,
      openid,
      ...(sceneValue !== undefined && Number.isSafeInteger(sceneValue) ? { sceneValue } : {}),
    };
  }

  private readElement(xml: string, elementName: string): string | undefined {
    const pattern = new RegExp(
      `<${elementName}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${elementName}>`,
      'i',
    );
    const match = pattern.exec(xml);
    return (match?.[1] ?? match?.[2])?.trim();
  }
}
