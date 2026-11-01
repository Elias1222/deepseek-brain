/**
 * 语义事实抽取：一条规则表 + 一套「什么不算事实」的否决条件。
 *
 * 这里的取舍：宁可漏，不要错。错的事实一旦进了语义库，会通过 prompt 注入影响之后每一轮回答，
 * 而漏掉的一条只是没被记住——后者可以在下次对话里补，前者要靠 brain_conflicts 一条条清理。
 */

/** 代词、指示词、语气词：抽到这些当宾语一定是规则写错了。 */
const STOP_OBJECTS = new Set([
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '大家', '别人', '自己',
  '这个', '那个', '这些', '那些', '这样', '那样', '这里', '那里', '什么', '怎么',
  '一个', '一件', '一下', '一些', '有点', '一点', '真的', '很', '挺', '太', '最',
  '就是', '还是', '也是', '不是', '都是', '的', '了', '吧', '呢', '啊', '的话',
]);

/** 收尾清理：宾语尾巴上这些虚词不属于事实本身。 */
const TRAIL = /(?:的|了|吧|呢|啊|呀|嘛|哦|哈|啦)+$/;

function clean(value) {
  const raw = String(value ?? '').replace(/^[\s:：,，、]+/, '').replace(TRAIL, '').trim();
  return raw;
}

function accept(value) {
  const v = clean(value);
  if (!v) return null;
  if (v.length < 1 || v.length > 20) return null;
  if (STOP_OBJECTS.has(v)) return null;
  if (/[吗呢么]$/.test(v)) return null;
  if (/^[0-9]+$/.test(v) && v.length > 6) return null;
  return v;
}

/** 问句不产事实：「你是设计师吗」不该记成职业。 */
function isQuestion(text) {
  return /[?？]\s*$/.test(text) || /(?:吗|呢|么)\s*[?？]?\s*$/.test(text);
}

/**
 * 规则表。`capture` 是宾语所在的捕获组序号（默认 1），
 * `subject` 可以是固定值，也可以是另一个捕获组序号。
 */
const RULES = [
  // ── 用户本人的稳定属性 ─────────────────────────────
  { id: 'name', relation: '姓名', importance: 5, skipQuestion: true, re: /我(?:的名字)?叫\s*([\u4e00-\u9fa5·]{2,6})/ },
  {
    id: 'job', relation: '职业', importance: 4, skipQuestion: true,
    /* 前置必须是句首/标点/「我」——「李雪是老师」不能记成用户的职业 */
    re: /(?:^|[\s，。；、,]|我|本人)\s*(?:是一名|是个|是|做|从事|干)\s*([\u4e00-\u9fa5A-Za-z]{2,14}?(?:师|员|生|家|工程师|经理|总监|老板|医生|老师|律师|会计|编辑|设计师|架构师|开发|运营|产品|研究|顾问))/,
  },
  { id: 'home', relation: '居住地', importance: 4, skipQuestion: true, re: /(?:我|本人)?\s*(?:住在|居住在|家住|家在|来自)\s*([\u4e00-\u9fa5]{2,12})/ },
  { id: 'company', relation: '公司', importance: 4, skipQuestion: true, re: /我在\s*([\u4e00-\u9fa5A-Za-z]{2,14}?)\s*(?:工作|上班|实习)/ },
  { id: 'age', relation: '年龄', importance: 3, skipQuestion: true, re: /我(?:今年)?\s*([0-9]{1,2})\s*岁/ },
  { id: 'birthday', relation: '生日', importance: 5, skipQuestion: true, re: /我(?:的)?生日\s*(?:是|在)?\s*([0-9]{1,2}\s*月\s*[0-9]{1,2}\s*[日号]|[0-9]{4}-[0-9]{2}-[0-9]{2})/ },
  { id: 'like', relation: '喜欢', importance: 3, re: /我(?:很|最|比较|特别)?(?:喜欢|爱|偏爱)\s*([^，。；！？\s]{1,16})/, skipQuestion: true },
  { id: 'dislike', relation: '不喜欢', importance: 3, re: /我(?:很|最|比较)?(?:讨厌|不喜欢|受不了)\s*([^，。；！？\s]{1,16})/, skipQuestion: true },
  {
    id: 'pet', relation: '宠物', importance: 3,
    re: /我(?:养了|养着|有一只|家有|家里有)?\s*(?:一?只|一?条)?\s*([\u4e00-\u9fa5]{0,3}?)(猫|狗|仓鼠|兔子|兔|鸟|鱼|龟)/,
    /* 量词进不了宾语：只取「（品种）+ 物种」 */
    object: (m) => ((m[1] || '').trim() + m[2]).trim(),
  },
  { id: 'plan', relation: '计划', importance: 3, re: /我(?:想|打算|准备|计划)\s*([^，。；！？]{2,20})/, skipQuestion: true },

  // ── 第三人称：抓「谁—身份—什么」 ────────────────────
  {
    id: 'person-role', relation: '身份', importance: 4, subjectCapture: 1, capture: 2,
    re: /([\u4e00-\u9fa5]{2,3})(?:是|是我的)\s*(同事|朋友|老板|上司|客户|同学|邻居|室友|搭档|导师|下属)/,
  },
  {
    id: 'kin-name', relation: '姓名', importance: 4, subjectCapture: 1,
    re: /我(?:的)?(妈妈|妈|爸爸|爸|母亲|父亲|哥哥|哥|姐姐|姐|弟弟|弟|妹妹|妹|老婆|老公|儿子|女儿)(?:叫|是)\s*([\u4e00-\u9fa5]{2,6})/,
    capture: 2,
  },

  {
    id: 'pronoun-role', relation: '身份', importance: 4, subjectCapture: 1, capture: 2,
    re: /(她|他|它|她们|他们|对方)(?:是|是我的)\s*(同事|朋友|老板|上司|客户|同学|邻居|室友|搭档|导师|下属)/,
  },

  // ── 偏好型指令进程序记忆 ─────────────────────────────
  { id: 'rule', procedural: true, importance: 4, re: /(?:记住|记一下|以后都|以后要|下次记得|别再)\s*[:：,，\s]*(.{2,80})/ },
];

export function extractFacts(text, { now: _now } = {}) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { facts: [], rules: [], unbound: [] };

  const question = isQuestion(raw);
  const facts = [];
  const rules = [];
  const unbound = [];
  const seen = new Set();

  for (const rule of RULES) {
    if (question && rule.skipQuestion) continue;
    const m = raw.match(rule.re);
    if (!m) continue;
    const picked = typeof rule.object === 'function' ? rule.object(m) : m[rule.capture ?? 1];
    const object = accept(picked);
    if (!object) continue;

    if (rule.procedural) {
      if (!seen.has('rule:' + object)) {
        seen.add('rule:' + object);
        rules.push({ rule: object, importance: rule.importance, source: 'auto' });
      }
      continue;
    }

    let subject = rule.subjectCapture
      ? clean(m[rule.subjectCapture])
      : '用户';
    if (!subject) continue;

    if (PRONOUNS.has(subject)) {
      const bound = antecedentBefore(raw, m.index ?? 0);
      if (!bound) {
        /* 绑不上就不写：把不确定的关系记成事实，比漏掉更糟 */
        unbound.push({ relation: rule.relation, object, pronoun: subject });
        continue;
      }
      subject = bound;
    }
    const key = `${subject}\u0000${rule.relation}\u0000${object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      subject: subject === '我' ? '用户' : subject,
      relation: rule.relation,
      object,
      importance: rule.importance,
      rule: rule.id,
      source: 'auto',
    });
  }

  return { facts, rules, unbound };
}


/** 中文数字 → 数字（只到 59，够钟点用）。 */
function cnNumber(token) {
  if (/^\d+$/.test(token)) return Number(token);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (token === '十') return 10;
  if (token.startsWith('十')) return 10 + (digits[token[1]] ?? 0);
  if (token.includes('十')) {
    const [a, b] = token.split('十');
    return (digits[a] ?? 0) * 10 + (digits[b] ?? 0);
  }
  return digits[token] ?? null;
}

/** 「下午三点半」「19:30」「上午十点一刻」→ {hh, mm, label}。 */
function readClock(raw) {
  const m = raw.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?:[:：点时])\s*(半|一刻|三刻|\d{1,2}|[一二三四五六七八九十]{1,3})?\s*分?/);
  if (!m) return null;
  let hh = cnNumber(m[2]);
  if (hh === null || hh > 24) return null;
  let mm = 0;
  if (m[3] === '半') mm = 30;
  else if (m[3] === '一刻') mm = 15;
  else if (m[3] === '三刻') mm = 45;
  else if (m[3]) {
    const v = cnNumber(m[3]);
    if (v !== null && v < 60) mm = v;
  }
  const period = m[1] || '';
  if ((period === '下午' || period === '傍晚' || period === '晚上') && hh < 12) hh += 12;
  if (period === '中午' && hh < 12) hh += 12;
  if (period === '凌晨' && hh === 12) hh = 0;
  return { hh, mm, label: m[0].replace(/\s+/g, '') };
}

/** 代词：配对不能靠猜，只能靠「同一句里前面出现过的人」。 */
const PRONOUNS = new Set(['她', '他', '它', '她们', '他们', '对方', '这个人', '那个人']);

/** 在 match 之前最近的一个人名（「张伟说…」「李雪和…」）。 */
function antecedentBefore(raw, index) {
  const head = raw.slice(0, Math.max(0, index));
  /* 名字前面必须有边界，否则「和张伟在…」会把连词一起吃进主语 */
  const names = [...head.matchAll(/(?:^|[和跟与同及\s，,、。；;])([\u4e00-\u9fa5]{2,3})(?=说|是|叫|给|帮|要|会|在|的|，|,)/g)];
  for (let i = names.length - 1; i >= 0; i -= 1) {
    const candidate = clean(names[i][1]);
    if (!candidate) continue;
    if (/^[和跟与同及]/.test(candidate)) continue;
    if (STOP_OBJECTS.has(candidate)) continue;
    return candidate;
  }
  return null;
}

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };

function atDay(base, offsetDays, hour = 0, minute = 0) {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

function lastDayOfMonth(base) {
  const d = new Date(base);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * 时间短语 → 绝对时刻。只覆盖「下周三」「月底」「3 月 7 号」这类常见说法；
 * 解析不出来就返回 null，绝不用 now 冒充。
 */
export function parseWhen(text, now = Date.now()) {
  const raw = String(text ?? '');
  if (!raw) return null;
  let at = null;
  let label = '';

  const take = (re, fn) => {
    if (at !== null) return;
    const m = raw.match(re);
    if (!m) return;
    const v = fn(m);
    if (v === null || v === undefined) return;
    at = v;
    label = m[0];
  };

  take(/大后天/, () => atDay(now, 3));
  take(/今天|今日|now/i, () => atDay(now, 0));
  take(/明天|明日/, () => atDay(now, 1));
  take(/后天/, () => atDay(now, 2));
  take(/昨天|昨日/, () => atDay(now, -1));
  take(/前天/, () => atDay(now, -2));

  take(/(下|这|本)?(?:周|星期|礼拜)([一二三四五六日天1-7])/, (m) => {
    const target = WEEKDAY[m[2]];
    if (!target) return null;
    const base = new Date(now);
    const current = base.getDay() === 0 ? 7 : base.getDay();
    let delta = target - current;
    if (m[1] === '下') delta += delta <= 0 ? 7 : 7;
    else if (delta < 0) delta += 7;
    return atDay(now, delta);
  });

  take(/下(?:个)?月(\d{1,2})[日号]/, (m) => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() + 1, Number(m[1]), 0, 0, 0, 0).getTime();
  });
  take(/下(?:个)?月/, () => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
  });
  take(/月底|这个月底/, () => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), lastDayOfMonth(now), 0, 0, 0, 0).getTime();
  });
  take(/月初/, () => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
  });
  take(/(\d{4})-(\d{1,2})-(\d{1,2})/, (m) => new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime());
  take(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/, (m) => {
    const d = new Date(now);
    const candidate = new Date(d.getFullYear(), Number(m[1]) - 1, Number(m[2]), 0, 0, 0, 0).getTime();
    /* 已经过去的日子，指的是明年 */
    return candidate < atDay(now, 0) ? new Date(d.getFullYear() + 1, Number(m[1]) - 1, Number(m[2])).getTime() : candidate;
  });

  const dateLabel = label;
  const clock = readClock(raw);
  if (clock) {
    const d = new Date(at ?? atDay(now, 0));
    d.setHours(clock.hh, clock.mm, 0, 0);
    at = d.getTime();
    label = dateLabel && clock.label ? dateLabel + clock.label : dateLabel || clock.label || '';
  }

  return at === null ? null : { at, label: label || '…' };
}
