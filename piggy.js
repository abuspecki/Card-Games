// The piggy bank: every tip for a dealer goes in. When it holds 500,000 chips,
// every member receives 100 coins and the piggy starts again (what is above
// 500,000 stays in). Kept in the database, so a restart loses nothing; a full
// piggy is paid out exactly once, even when two tips arrive at the same time.
const GOAL = 500000;
const REWARD = 100;

function createPiggy(ctx) {
  const store = () => ctx.store();
  let busy = Promise.resolve();

  async function payout() {
    while ((await store().piggyTake(GOAL)) !== null) {
      const ids = await store().allUserIds();
      for (const id of ids) {
        try { await ctx.coins().adjust(id, REWARD, 0, 'piggy'); } catch (e) { console.error('piggy reward', e.message); }
      }
      if (ctx.lobby && ctx.lobby.announce) ctx.lobby.announce(`🐷 The piggy bank is full! Every member gets ${REWARD} coins — thank you for all the tips!`, 6 * 60);
      try { await store().logAdmin('house', `piggy bank full: ${REWARD} coins for ${ids.length} members`); } catch { /* ignore */ }
      console.log(`[piggy] full — ${REWARD} coins for ${ids.length} members`);
    }
  }

  return {
    GOAL, REWARD,
    // add a tip; pays out when the goal is reached
    add(amount) {
      busy = busy.then(async () => {
        await store().piggyAdd(amount);
        await payout();
      }).catch((e) => console.error('piggy', e.message));
      return busy;
    },
    async info() { return { total: await store().piggyTotal(), goal: GOAL, reward: REWARD }; },
  };
}

module.exports = { createPiggy, GOAL, REWARD };
