const db = require('./db')

module.exports = {
  ensureIndex: async () => {
    const isDedup = process.env['CRAWLAB_IS_DEDUP']
    const dedupField = process.env['CRAWLAB_DEDUP_FIELD']

    try {
      const col = await db.getCollection()

      if (isDedup) {
        await col.createIndex(dedupField, { unique: true })
      } else {
        await col.dropIndex(dedupField)
      }
    } catch (e) {}
  },
  saveItem: async (item) => {
    const col = await db.getCollection()
    item['task_id'] = process.env['CRAWLAB_TASK_ID']
    const isDedup = process.env['CRAWLAB_IS_DEDUP']
    const dedupField = process.env['CRAWLAB_DEDUP_FIELD']
    const dedupMethod = process.env['CRAWLAB_DEDUP_METHOD']
    try {
      if (isDedup) {
        if (dedupMethod === 'overwrite') {
          const query = {}
          query[dedupField] = item[dedupField]
          await col.removeOne(query)
          await col.insertOne(item)
        } else if (dedupMethod === 'ignore') {
          await col.insertOne(item)
        } else {
          await col.insertOne(item)
        }
      } else {
        await col.insertOne(item)
      }
    } catch (e) {
      // do nothing
    }
  },
  close: async () => {
    const client = await db.getClient()
    await client.close()
  }
}
