/* apiError.js — unified error responses for all API routes
 * Usage: throw new ApiError(404, 'NOT_FOUND', 'Project not found');
 * The global error handler catches it and sends the standard envelope.
 */

function ApiError(status, code, message, details) {
  this.status = status || 500;
  this.code = code || 'INTERNAL';
  this.message = message || 'Internal server error';
  this.details = details || null;
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;

module.exports = ApiError;
