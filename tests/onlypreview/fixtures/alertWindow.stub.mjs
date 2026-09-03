// Stands in for the alert window service so the New Folder flow can be driven without a window.
// `answers` is the sequence of names the dialog "returns"; an empty sequence is a cancel.
const stubState = (globalThis.__bitterlessAlertWindowStub ??= {
  answers: [],
  requests: [],
  errors: []
});

export const state = stubState;

export const resetAlertWindowStub = (answers = []) => {
  stubState.answers = [...answers];
  stubState.requests = [];
  stubState.errors = [];
};

export const onlyPreviewAlertWindowService = {
  async requestNewFolder(_hostToken, request, commit) {
    stubState.requests.push(request);
    for (;;) {
      const answer = stubState.answers.shift();
      if (answer === undefined) return false;
      const outcome = await commit(answer);
      if (outcome.ok) return true;
      // A rejected name keeps the dialog open, so the stub records the message and takes the next
      // answer — exactly what the real view service does with the owner's next attempt.
      if (outcome.error) stubState.errors.push(outcome.error);
      else return false;
    }
  },
  async requestConfirm() {
    return false;
  },
  async showError(_hostToken, request) {
    stubState.errors.push(request);
  },
  isOpen() {
    return stubState.requests.length > 0;
  }
};
