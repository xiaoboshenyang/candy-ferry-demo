// Selection is by mother question. Variant rotation survives session restarts.
export class QuestionPicker {
  constructor(levels, random = Math.random) {
    this.random = random;
    this.byLevel = new Map();
    this.variantCursor = new Map();
    for (const question of levels) {
      const level = Number(question.level), mother = question.motherId;
      if (!mother) throw Error(`题目 ${question.id} 缺少 motherId`);
      if (!this.byLevel.has(level)) this.byLevel.set(level, new Map());
      const group = this.byLevel.get(level);
      if (!group.has(mother)) group.set(mother, []);
      group.get(mother).push(question);
    }
    for (const groups of this.byLevel.values()) for (const variants of groups.values()) variants.sort((a,b) => a.id.localeCompare(b.id));
    this.startSession();
  }
  startSession() { this.usedMothers = new Set(); this.lastUsed = new Map(); this.sequence = 0; }
  next(level) {
    const groups = this.byLevel.get(Number(level));
    if (!groups?.size) throw Error(`L${level} 没有可用母题`);
    const unused = [...groups.keys()].filter(m => !this.usedMothers.has(m));
    const repeated = unused.length === 0;
    let mother;
    if (unused.length) mother = unused[Math.floor(this.random() * unused.length)];
    else mother = [...groups.keys()].sort((a,b) => (this.lastUsed.get(a) ?? -1) - (this.lastUsed.get(b) ?? -1))[0];
    this.usedMothers.add(mother); this.lastUsed.set(mother, ++this.sequence);
    const variants = groups.get(mother), cursor = this.variantCursor.get(mother) ?? Math.floor(this.random() * variants.length);
    this.variantCursor.set(mother, cursor + 1);
    return {question: variants[cursor % variants.length], repeated, motherCount: groups.size};
  }
}
