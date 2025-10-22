export function ValidateToken(context) {
    let tokenUser = String(context.req.headers.authorization).replace('Bearer ', '');
    tokenUser = tokenUser.replace(/"/g, '');

    let userId;

    if (tokenUser && tokenUser !== 'undefined') {
        userId = common.getUserId(tokenUser);
    }

    return userId;
}