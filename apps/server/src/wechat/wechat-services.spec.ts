import { WechatAccessTokenService } from './wechat-access-token.service';
import { RealWechatQrcodeService } from './real-wechat-qrcode.service';
import { MockWechatQrcodeService } from './mock-wechat-qrcode.service';
import { WechatEventService } from './wechat-event.service';
import { RealWechatCustomerServiceService } from './real-wechat-customer-service.service';
import { MockWechatCustomerServiceService } from './mock-wechat-customer-service.service';
import { RealWechatNotifyService } from './real-wechat-notify.service';

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Response;

const imageResponse = (body: string): Response =>
  ({
    ok: true,
    status: 200,
    arrayBuffer: jest.fn().mockResolvedValue(Buffer.from(body)),
  }) as unknown as Response;

describe('WechatAccessTokenService', () => {
  const originalAppId = process.env.WECHAT_APPID;
  const originalSecret = process.env.WECHAT_SECRET;

  beforeEach(() => {
    process.env.WECHAT_APPID = 'test-appid';
    process.env.WECHAT_SECRET = 'test-secret';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalAppId === undefined) delete process.env.WECHAT_APPID;
    else process.env.WECHAT_APPID = originalAppId;
    if (originalSecret === undefined) delete process.env.WECHAT_SECRET;
    else process.env.WECHAT_SECRET = originalSecret;
  });

  it('缓存 access_token，并在显式失效后重新获取', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-2', expires_in: 7200 }));
    const service = new WechatAccessTokenService();

    await expect(service.getAccessToken()).resolves.toBe('token-1');
    await expect(service.getAccessToken()).resolves.toBe('token-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('appid=test-appid');

    service.invalidateAccessToken();
    await expect(service.getAccessToken()).resolves.toBe('token-2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('微信未返回 access_token 时抛出明确错误', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }));

    await expect(new WechatAccessTokenService().getAccessToken()).rejects.toThrow(
      '获取 access_token 失败: invalid appid',
    );
  });
});

describe('Wechat qrcode services', () => {
  afterEach(() => jest.restoreAllMocks());

  it('真实实现创建临时二维码并将图片转换为 data URL', async () => {
    const accessTokenService = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidateAccessToken: jest.fn(),
    } as unknown as WechatAccessTokenService;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ticket: 'ticket-123' }))
      .mockResolvedValueOnce(imageResponse('png-data'));

    const result = await new RealWechatQrcodeService(accessTokenService).createSceneQrcode(123);

    expect(result).toEqual({
      ticket: 'ticket-123',
      qrCodeImage: `data:image/png;base64,${Buffer.from('png-data').toString('base64')}`,
    });
    const createRequest = fetchSpy.mock.calls[0];
    expect(createRequest[0]).toContain('/cgi-bin/qrcode/create?access_token=access-token');
    expect(JSON.parse((createRequest[1] as RequestInit).body as string)).toEqual({
      expire_seconds: 2592000,
      action_name: 'QR_SCENE',
      action_info: { scene: { scene_id: 123 } },
    });
    expect(fetchSpy.mock.calls[1][0]).toContain('showqrcode?ticket=ticket-123');
  });

  it('access_token 过期时失效缓存并只重试一次', async () => {
    const accessTokenService = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidateAccessToken: jest.fn(),
    } as unknown as WechatAccessTokenService;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: 'expired' }))
      .mockResolvedValueOnce(jsonResponse({ ticket: 'retry-ticket' }))
      .mockResolvedValueOnce(imageResponse('retry-image'));

    await expect(
      new RealWechatQrcodeService(accessTokenService).createSceneQrcode(456, 60),
    ).resolves.toMatchObject({ ticket: 'retry-ticket' });
    expect(accessTokenService.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('Mock 实现不调用微信', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(new MockWechatQrcodeService().createSceneQrcode(9)).resolves.toEqual({
      ticket: 'mock-ticket-9',
      qrCodeImage: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('WechatEventService', () => {
  const service = new WechatEventService();

  it('解析未关注用户扫码后的 subscribe 事件及具体场景值', () => {
    const xml =
      '<xml><ToUserName><![CDATA[toUser]]></ToUserName>' +
      '<FromUserName><![CDATA[fromUser]]></FromUserName>' +
      '<CreateTime>123456789</CreateTime><MsgType><![CDATA[event]]></MsgType>' +
      '<Event><![CDATA[subscribe]]></Event><EventKey><![CDATA[qrscene_123]]></EventKey>' +
      '<Ticket><![CDATA[TICKET]]></Ticket></xml>';

    expect(service.parseEvent(xml)).toEqual({
      eventType: 'subscribe',
      openid: 'fromUser',
      sceneValue: 123,
    });
  });

  it('解析已关注用户的 SCAN 事件及具体场景值', () => {
    const xml =
      '<xml><FromUserName><![CDATA[FROMUSER]]></FromUserName>' +
      '<MsgType><![CDATA[event]]></MsgType><Event><![CDATA[SCAN]]></Event>' +
      '<EventKey><![CDATA[456]]></EventKey><Ticket><![CDATA[TICKET]]></Ticket></xml>';

    expect(service.parseEvent(xml)).toEqual({
      eventType: 'scan',
      openid: 'FROMUSER',
      sceneValue: 456,
    });
  });

  it('其他消息归为 other，无法解析的场景值不返回 sceneValue', () => {
    expect(
      service.parseEvent(
        '<xml><FromUserName>openid</FromUserName><MsgType>event</MsgType>' +
          '<Event>unsubscribe</Event><EventKey>not-a-number</EventKey></xml>',
      ),
    ).toEqual({ eventType: 'other', openid: 'openid' });
  });
});

describe('Wechat customer message services', () => {
  afterEach(() => jest.restoreAllMocks());

  it('真实实现按客服文本消息格式发送，并在 token 过期时重试一次', async () => {
    const accessTokenService = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidateAccessToken: jest.fn(),
    } as unknown as WechatAccessTokenService;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid token' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await expect(
      new RealWechatCustomerServiceService(accessTokenService).sendTextMessage(
        'openid-1',
        '请完成合同签约',
      ),
    ).resolves.toBe(true);
    expect(accessTokenService.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      touser: 'openid-1',
      msgtype: 'text',
      text: { content: '请完成合同签约' },
    });
  });

  it('Mock 实现返回 true 且不调用微信', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(
      new MockWechatCustomerServiceService().sendTextMessage('openid', 'content'),
    ).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('RealWechatNotifyService shared access token', () => {
  afterEach(() => jest.restoreAllMocks());

  it('模板消息 token 过期时通过共享服务失效并重试', async () => {
    const accessTokenService = {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
      invalidateAccessToken: jest.fn(),
    } as unknown as WechatAccessTokenService;
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: 'expired' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, msgid: 1 }));

    await expect(
      new RealWechatNotifyService(accessTokenService).sendTemplateMessage({
        openid: 'openid',
        templateId: 'template',
        data: { thing1: { value: 'value' } },
      }),
    ).resolves.toBe(true);
    expect(accessTokenService.invalidateAccessToken).toHaveBeenCalledTimes(1);
  });
});
