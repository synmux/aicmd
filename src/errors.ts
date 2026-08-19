/** Error type for user-facing, expected failures (printed without a stack trace). */
export class AicmdError extends Error {
  override name = 'AicmdError'
}
