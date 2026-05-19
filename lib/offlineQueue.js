import AsyncStorage from '@react-native-async-storage/async-storage'

const QUEUE_KEY = 'samtrackly_offline_queue'
const ID_MAPPINGS_KEY = 'samtrackly_id_mappings'

function generateId() {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export async function enqueueOperation(funcName, args) {
  try {
    const queue = await getQueue()
    const item = {
      id: generateId(),
      timestamp: Date.now(),
      funcName,
      args,
      status: 'pending',
      attempts: 0,
      lastError: null,
    }
    queue.push(item)
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    return item.id
  } catch (e) {
    console.error('offlineQueue.enqueue error:', e)
    return null
  }
}

export async function getQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function removeFromQueue(id) {
  try {
    const queue = await getQueue()
    const updated = queue.filter(item => item.id !== id)
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('offlineQueue.remove error:', e)
  }
}

export async function getQueueSize() {
  try {
    const queue = await getQueue()
    return queue.filter(item => item.status !== 'failed').length
  } catch {
    return 0
  }
}

export async function clearQueue() {
  await AsyncStorage.removeItem(QUEUE_KEY)
}

// ─── Mappings ID locaux → vrais IDs Supabase ──────────────────────────────
export async function getIdMappings() {
  try {
    const raw = await AsyncStorage.getItem(ID_MAPPINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function saveIdMapping(localId, realId) {
  try {
    const mappings = await getIdMappings()
    mappings[localId] = realId
    await AsyncStorage.setItem(ID_MAPPINGS_KEY, JSON.stringify(mappings))
  } catch {}
}

async function clearIdMappings() {
  try { await AsyncStorage.removeItem(ID_MAPPINGS_KEY) } catch {}
}

// Remplace les IDs locaux par les vrais IDs dans les args
function patchArgs(args, mappings) {
  if (!mappings || Object.keys(mappings).length === 0) return args
  try {
    let str = JSON.stringify(args)
    Object.entries(mappings).forEach(([localId, realId]) => {
      str = str.split(localId).join(realId)
    })
    return JSON.parse(str)
  } catch {
    return args
  }
}

// ─── Traitement de la file d'attente ──────────────────────────────────────
export async function processQueue(apiModule, onProgress) {
  const queue = await getQueue()
  const pendingItems = queue
    .filter(item => item.status === 'pending')
    .sort((a, b) => a.timestamp - b.timestamp)

  if (pendingItems.length === 0) return { success: 0, failed: 0 }

  const mappings = await getIdMappings()
  let successCount = 0
  let failCount = 0

  for (const item of pendingItems) {
    if (onProgress) onProgress({ current: successCount + failCount, total: pendingItems.length })

    const fn = apiModule[item.funcName]
    if (typeof fn !== 'function') {
      console.warn('offlineQueue: fonction inconnue:', item.funcName)
      await removeFromQueue(item.id)
      continue
    }

    // Patcher les args avec les vrais IDs
    const patchedArgs = patchArgs(item.args, mappings)

    try {
      const result = await fn(...patchedArgs)

      // Si getOrCreatePoint → capturer le mapping ID local → réel
      if (item.funcName === 'getOrCreatePoint' && result && result.id && item._localPointId) {
        mappings[item._localPointId] = result.id
        await saveIdMapping(item._localPointId, result.id)
      }

      await removeFromQueue(item.id)
      successCount++
    } catch (error) {
      const newAttempts = (item.attempts || 0) + 1
      const allQueue = await getQueue()
      const idx = allQueue.findIndex(q => q.id === item.id)
      if (idx >= 0) {
        allQueue[idx].attempts = newAttempts
        allQueue[idx].lastError = (error && error.message) ? error.message : 'Erreur inconnue'
        if (newAttempts >= 3) {
          allQueue[idx].status = 'failed'
        }
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(allQueue))
      }
      failCount++
      console.warn(`offlineQueue: échec ${item.funcName} (tentative ${newAttempts}):`, error)
    }
  }

  if (failCount === 0) await clearIdMappings()

  return { success: successCount, failed: failCount }
}
