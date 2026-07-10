/**
 * MongoDB connection helpers. The server works against any MONGODB_URI —
 * a locally-run mongod, docker compose's container, or DO Managed MongoDB.
 */
import mongoose from 'mongoose'

/** Connects to MongoDB; rejects if the server is unreachable. */
export const connectMongo = async (uri: string): Promise<void> => {
  await mongoose.connect(uri)
}

export const disconnectMongo = async (): Promise<void> => {
  await mongoose.disconnect()
}

/** True when the default connection is up. */
export const isMongoConnected = (): boolean =>
  mongoose.connection.readyState === 1

/** Pings the database; false when disconnected or the ping fails. */
export const pingMongo = async (): Promise<boolean> => {
  if (!isMongoConnected()) return false
  try {
    await mongoose.connection.db?.admin().ping()
    return true
  } catch {
    return false
  }
}
