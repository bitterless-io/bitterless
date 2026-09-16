module.exports = { utilityProcess: { fork() { throw new Error('Node tests must inject the process factory') } } }
