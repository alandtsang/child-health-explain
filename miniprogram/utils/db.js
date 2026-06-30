// miniprogram/utils/db.js
// 数据库查询相关的共享工具函数

// 微信云开发查询不存在的集合时，错误信息包含 collection not exists 或 errCode -502003
// 与 cloudfunctions/login/index.js 中的 isCollectionMissingError 保持一致
function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}

module.exports = { isCollectionMissingError }
