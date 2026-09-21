import { maskPii, REDACTED } from './pii-mask';

describe('pii-mask（审计日志 PII 脱敏）', () => {
  describe('租约创建请求体（POST /leases）', () => {
    it('掩码租客姓名/手机号/身份证号和车牌，保留业务字段', () => {
      const body = {
        roomId: 12,
        tenantName: '王小明',
        tenantPhone: '13812345678',
        tenantIdCard: '310101199001011234',
        carPlate: '粤B12345',
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        rent: 2500,
        deposit: 5000,
        feeItems: [
          { name: '电费', amount: 100 },
          { name: '水费', amount: 30 },
        ],
      };

      const masked = maskPii(body) as typeof body;

      expect(masked.tenantName).toBe('王**');
      expect(masked.tenantPhone).toBe('138****5678');
      expect(masked.tenantIdCard).toBe('310***********1234');
      expect(masked.carPlate).toBe('粤B***45');
      // 业务字段不受影响
      expect(masked.roomId).toBe(12);
      expect(masked.rent).toBe(2500);
      expect(masked.feeItems).toEqual([
        { name: '电费', amount: 100 },
        { name: '水费', amount: 30 },
      ]);
    });
  });

  describe('合同设置请求体（admin）', () => {
    it('掩码房东姓名/身份证号/手机号', () => {
      const masked = maskPii({
        landlordName: '张三',
        landlordIdCard: '110101198501012345',
        landlordPhone: '13998765432',
        defaultPenaltyMonths: 1,
      }) as Record<string, string | number>;

      expect(masked.landlordName).toBe('张*');
      expect(masked.landlordIdCard).toBe('110***********2345');
      expect(masked.landlordPhone).toBe('139****5432');
      expect(masked.defaultPenaltyMonths).toBe(1);
    });
  });

  describe('凭证类字段整体抹除', () => {
    it('password/secret/token/inviteCode 替换为 [REDACTED]', () => {
      const masked = maskPii({
        password: 'p@ssw0rd',
        secret: 'abc',
        token: 'jwt-token-value',
        inviteCode: 'a1b2c3d4e5',
      }) as Record<string, string>;

      expect(masked.password).toBe(REDACTED);
      expect(masked.secret).toBe(REDACTED);
      expect(masked.token).toBe(REDACTED);
      expect(masked.inviteCode).toBe(REDACTED);
    });

    it('不误伤含 code 字样的非凭证字段（qrcodeImageUrl 等）', () => {
      const masked = maskPii({
        qrcodeImageUrl: 'https://landlordeasy.cn/qr/room-12.png',
        endReason: '租客提前退租',
      }) as Record<string, string>;

      expect(masked.qrcodeImageUrl).toBe('https://landlordeasy.cn/qr/room-12.png');
      expect(masked.endReason).toBe('租客提前退租');
    });
  });

  describe('业务 name 字段不脱敏', () => {
    it('楼栋/房产/房型等 name 保持明文，保证审计可读', () => {
      const masked = maskPii({
        name: 'Q栋',
        buildingName: 'Q栋',
        propertyName: '嘉定公寓',
        roomTypeName: '标准间',
      }) as Record<string, string>;

      expect(masked.name).toBe('Q栋');
      expect(masked.buildingName).toBe('Q栋');
      expect(masked.propertyName).toBe('嘉定公寓');
      expect(masked.roomTypeName).toBe('标准间');
    });
  });

  describe('其他 PII 变体', () => {
    it('邮箱保留首字符和域名', () => {
      const masked = maskPii({ email: 'zhangsan@example.com' }) as Record<string, string>;
      expect(masked.email).toBe('z***@example.com');
    });

    it('银行卡号保留后 4 位', () => {
      const masked = maskPii({ bankCardNo: '6222020200112233445' }) as Record<string, string>;
      expect(masked.bankCardNo).toBe('***************3445');
    });

    it('微信 openid 保留首尾各 4 位', () => {
      const openid = 'o6_bmjrPTlm6_2sgVt7hMZOPfL2M';
      const masked = maskPii({ openid }) as Record<string, string>;
      expect(masked.openid).toBe(
        `${openid.slice(0, 4)}${'*'.repeat(openid.length - 8)}${openid.slice(-4)}`,
      );
      expect(masked.openid).not.toContain('mjrPTlm6');
    });

    it('蛇形/带空格的字段名同样命中（tenant_phone / Tenant Phone）', () => {
      const masked = maskPii({
        tenant_phone: '13812345678',
        'Tenant Phone': '13812345678',
        TENANT_ID_CARD: '310101199001011234',
      }) as Record<string, string>;

      expect(masked.tenant_phone).toBe('138****5678');
      expect(masked['Tenant Phone']).toBe('138****5678');
      expect(masked.TENANT_ID_CARD).toBe('310***********1234');
    });

    it('短值不足保留位数时全掩码', () => {
      const masked = maskPii({ phone: '1234567' }) as Record<string, string>;
      expect(masked.phone).toBe('*******');
      expect(masked.phone).not.toContain('1234567');
    });
  });

  describe('结构边界', () => {
    it('嵌套数组内的对象字段同样脱敏', () => {
      const masked = maskPii({
        tenants: [{ name: '李四', tenantPhone: '13711112222', idCard: '110101199001011234' }],
      }) as { tenants: Array<Record<string, string>> };

      expect(masked.tenants[0].tenantPhone).toBe('137****2222');
      expect(masked.tenants[0].idCard).toBe('110***********1234');
    });

    it('不修改原始对象（返回新副本）', () => {
      const body = { tenantName: '王小明', nested: { password: 'x' } };
      maskPii(body);
      expect(body.tenantName).toBe('王小明');
      expect(body.nested.password).toBe('x');
    });

    it('循环引用与超深嵌套安全返回占位符', () => {
      const cyclic: Record<string, unknown> = { tenantName: '张三' };
      cyclic['self'] = cyclic;
      const masked = maskPii(cyclic) as Record<string, unknown>;
      expect(masked.tenantName).toBe('张*');
      expect(masked.self).toBe('[CIRCULAR]');

      let deep: unknown = { tenantPhone: '13812345678' };
      for (let i = 0; i < 12; i++) deep = { level: deep };
      const deepMasked = maskPii(deep) as Record<string, unknown>;
      expect(JSON.stringify(deepMasked)).toContain('[MAX_DEPTH]');
    });

    it('Date 等非普通对象替换为占位符，不泄漏内部结构', () => {
      const masked = maskPii({ file: new Date() }) as Record<string, unknown>;
      expect(masked.file).toBe('[非文本字段]');
    });

    it('null/undefined 请求体返回空对象语义', () => {
      expect(maskPii(undefined)).toEqual({});
      expect(maskPii(null)).toEqual({});
    });
  });
});
