// List of displays. TODO: look with a monitor
let displays = [];
// list of tab ids by last recent
const lastTabIds = [];

// send the tab id at the end of the history queue
const pushTab = tabId => {
  removeTab(tabId);
  lastTabIds.push(tabId);
};

// remove a tab id from the history queue
const removeTab = tabId => {
  const index = lastTabIds.indexOf(tabId);
  if (index !== -1) {
    lastTabIds.splice(index, 1);
  }
}

// return the current active tab
const getActiveTab = (windows) => {
  const activeWindow = windows.filter(win => win.focused)[0];
  if (!activeWindow) { return; }
  return activeWindow.tabs.filter(tab => tab.active)[0];
};

const isTabEmpty = (tab) => {
  return tab.url === 'chrome://newtab/';
};

// return all windows
const getWindows = () => new Promise((resolve) => {
  chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
    resolve(windows.filter(w => w.state !== 'minimized'));
  });
});

// return all displays
const getDisplay = () => new Promise((resolve) => {
  chrome.system.display.getInfo({ }, resolve);
});

// create a new window at the desired position
const chromeCreateWindow = ({ left = null, top = null, width = null, height = null, focused = null }) =>
  new Promise((resolve) => {  
    chrome.windows.create(
      {
        left: Math.round(left === null ? win.left : left),
        top: Math.round(top === null ? win.top : top),
        width: Math.round(width === null ? win.width : width),
        height: Math.round(height === null ? win.height : height),
        focused: !!focused,
      },
      resolve
    );
  });

// move a window to the desired position
const chromeUpdateWindow = (win, { left = null, top = null, width = null, height = null, focused = null }) =>
  new Promise((resolve) => {  
    chrome.windows.update(
      win.id,
      {
        left: Math.round(left === null ? win.left : left),
        top: Math.round(top === null ? win.top : top),
        width: Math.round(width === null ? win.width : width),
        height: Math.round(height === null ? win.height : height),
        focused: !!focused,
      },
      resolve
    );
  });

// remove a window
const chromeRemoveWindow = (win) =>
  new Promise((resolve) => {  
    chrome.windows.remove(
      win.id,
      resolve
    );
  });

// remove a tab
const chromeRemoveTab = (tab) =>
  new Promise((resolve) => {  
    chrome.tabs.remove(
      tab.id,
      resolve
    );
  });

// update a tab
const chromeUpdateTab = (tab, { active }) =>
  new Promise((resolve) => {  
    chrome.tabs.update(
      tab.id,
      { active },
      resolve
    );
  });

// move a list of tabs to the end of a desired window at once
const chromeMoveTabs = (tabs, { toWindow: win }) =>
  new Promise((resolve) => {
    const tabIds = tabs.map(tab => tab.id);
    chrome.tabs.move(
      tabIds,
      { windowId: win.id, index: win.tabs.length },
      resolve
    );
  });


// move the window to the posittion offset over the number splits
const setWindow = async (win, { toPosition: offset, over: splits }) => {
  const display = displays[0];
  if (!display) { return; }

  const width = display.bounds.width / splits;
  await chromeUpdateWindow(win, {
    left: width * offset,
    width,
    top: 0,
    height: display.bounds.height,
    focused: win.focused,
  });
};

// create a new window positioned for the given offset and number of splits
const createWindow = async ({ toPosition: offset, over: splits, focused }) => {
  const display = displays[0];
  if (!display) { return; }

  const width = display.bounds.width / splits;
  return await chromeCreateWindow({
    left: width * offset,
    width,
    top: 0,
    height: display.bounds.height,
    focused: !!focused,
  });
};

// return a list of tabs that can be used to populate new windows, chosen by most recently visited
const getExtraTabs = ({ from: windows, for: target }) => {
  let missingWindows = target - windows.length;
  if (missingWindows <= 0) { return []; }
  const tabIdToWin = {};
  const tabIdToTab = {};
  windows.forEach(win => win.tabs.forEach(tab => {
    tabIdToWin[tab.id] = win.id;
    tabIdToTab[tab.id] = tab;
  }));
  const counters = {};
  windows.forEach(win => {
    counters[win.id] = win.tabs.length;
  });

  const extraTabs = [];
  for (let i=lastTabIds.length - 1; i>=0; i--) {
    const tabId = lastTabIds[i];
    if (counters[tabIdToWin[tabId]] > 1) {
      const windowId = tabIdToWin[tabId];
      let previousTabId;
      for (let j=i-1; j>=0; j--) {
        const id = lastTabIds[j];
        if (tabIdToWin[id] === windowId) {
          previousTabId = id;
          break;
        }
      }
      counters[windowId] -= 1;
      missingWindows -= 1;
      extraTabs.push({ tab: tabIdToTab[tabId], previousTabInWindow: tabIdToTab[previousTabId] });
      if (missingWindows === 0) {
        break;
      }
    }
  }
  return extraTabs;
};

// handle a new reorganization command
const handle = async (target, useEmptyWindows) => {
  let windows = await getWindows();
  const extraTabs = useEmptyWindows ? [] : getExtraTabs({ from: windows, for: target });
  while (windows.length < target) {
    // create new windows
    const win = await createWindow({ toPosition: windows.length, over: target, focused: true });
    windows.push(win);
    const extra = extraTabs.pop();
    if (extra) {
      const { tab, previousTabInWindow } = extra;
      // populate the new window
      await chromeMoveTabs([tab], { toWindow: win });
      if (previousTabInWindow) {
        await chromeUpdateTab(previousTabInWindow, { active: true });
      }
      await chromeRemoveTab(win.tabs[0]);
      await chromeUpdateWindow(win, { focused: true });
    }
  }
  windows = await getWindows();
  while (windows.length > target) {
    // remove extra window
    const win = windows.pop();
    const tabs = win.tabs.filter(tab => !isTabEmpty(tab));
    const previousWindow = windows[windows.length - 1];
    if (tabs.length) {
      await chromeMoveTabs(tabs, { toWindow: previousWindow }); 
    }
    await chromeRemoveWindow(win);
    await chromeUpdateWindow(previousWindow, { focused: true });
    windows = await getWindows();
  }
  windows = await getWindows();
  await windows.forEach(async (win, idx) => {
    await setWindow(win, { toPosition: idx, over: target });
  });
};


// starts listening to inputs

chrome.system.display.onDisplayChanged.addListener(() => {
  console.log('display changed!');
});

chrome.tabs.onSelectionChanged.addListener(pushTab);

chrome.windows.onFocusChanged.addListener(async () => {
  const windows = await getWindows();
  const activeTab = getActiveTab(windows);
  if (activeTab) {
    pushTab(activeTab.id);
  }
});

chrome.tabs.onRemoved.addListener(removeTab);

chrome.commands.onCommand.addListener(command => {
  const useEmptyWindows = command.indexOf('new-') !== -1;
  command = command.replace('new-', '');
  let i;
  try {
    i = parseInt(command.replace('group-by-', ''), 10);
  } catch (e) {
    console.log('error:', e);
  }
  handle(i, useEmptyWindows);
});

// get the initial windows setup
getWindows().then(windows => {
  const activeTab = getActiveTab(windows);
  if (activeTab) {
    pushTab(activeTab.id);
  }
});

// get the initial displays setup
getDisplay().then(results => {
  displays = results;
});
