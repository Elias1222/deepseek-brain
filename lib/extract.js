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

  // ── 偏好型指令进程序记忆 ─────────────────────────────
  { id: 'rule', procedural: true, importance: 4, re: /(?:记住|记一下|以后都|以后要|下次记得|别再)\s*[:：,，\s]*(.{2,80})/ },
];

export function extractFacts(text, { now: _now } = {}) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { facts: [], rules: [] };

  const question = isQuestion(raw);
  const facts = [];
  const rules = [];
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

    const subject = rule.subjectCapture
      ? clean(m[rule.subjectCapture])
      : '用户';
    if (!subject) continue;
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

  return { facts, rules };
}
