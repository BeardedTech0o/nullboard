(function () {
  'use strict';

  var COLUMNS = [
    { key: 'todo', label: 'To Do', color: '#3b82f6' },
    { key: 'inprogress', label: 'In Progress', color: '#f59e0b' },
    { key: 'signoff', label: 'Awaiting Sign-Off', color: '#ef4444' },
    { key: 'done', label: 'Completed', color: '#22c55e' },
  ];
  var THEMES = {
    ink: { label: 'Ink', accent: '#9184d9' },
    claret: { label: 'Claret', accent: '#b5665a' },
    moss: { label: 'Moss', accent: '#7f9c72' },
    gilt: { label: 'Gilt', accent: '#c9a35c' },
  };
  var PROJECT_COLORS = ['#9c5a52', '#5f7a5a', '#5d6f96', '#7c6091', '#b08a4e', '#4f8585'];
  var STORAGE_KEY = 'ashcombe-kanban-v1';
  var FONT_SIZES = [
    { key: 'xsmall', label: 'X-Small' },
    { key: 'small', label: 'Small' },
    { key: 'medium', label: 'Medium' },
    { key: 'large', label: 'Large' },
    { key: 'xlarge', label: 'X-Large' },
  ];

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function seedTemplates() {
    return [{
      id: 'tpl-example',
      name: 'Example Template',
      tiles: [{ title: 'Example task' }],
    }];
  }

  var state = {
    projects: [],
    tiles: [],
    templates: [],
    theme: 'ink',
    fontSize: 'medium',
    expandedProjects: {},
    expandedTiles: {},
    newProjectOpen: false,
    templatePickerOpen: false,
    templatePickerMode: 'list',
    templateDraft: null,
    createDialog: null,
    settingsOpen: false,
    newNoteDraftByTile: {},
    addTileDraftProjectId: null,
    addTileDraftText: '',
    confirmDeleteProject: null,
    pulseTileId: null,
    draggingTileId: null,
    draggingProjectId: null,
    renamingTileId: null,
    renameDraftText: '',
    renamingProjectId: null,
    renameProjectDraftText: '',
    archivedOpen: false,
    mobileSidebarOpen: false,
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        state.projects = data.projects || [];
        state.tiles = data.tiles || [];
        state.templates = (data.templates && data.templates.length) ? data.templates : seedTemplates();
        state.theme = data.theme || 'ink';
        state.fontSize = data.fontSize || 'medium';
      } else {
        state.templates = seedTemplates();
      }
    } catch (e) {
      state.templates = seedTemplates();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        projects: state.projects,
        tiles: state.tiles,
        templates: state.templates,
        theme: state.theme,
        fontSize: state.fontSize,
      }));
    } catch (e) {}
  }

  function render() {
    var root = document.getElementById('app');
    root.innerHTML = '';
    var accent = (THEMES[state.theme] || THEMES.ink).accent;
    root.style.setProperty('--accent', accent);
    document.documentElement.setAttribute('data-fontsize', state.fontSize);

    var anyOverlayOpen = state.newProjectOpen || state.settingsOpen || state.archivedOpen || state.mobileSidebarOpen;
    if (anyOverlayOpen) {
      var catcher = el('div', 'overlay-catcher' + (state.mobileSidebarOpen ? ' dim' : ''));
      catcher.addEventListener('click', function () {
        state.newProjectOpen = false;
        state.settingsOpen = false;
        state.archivedOpen = false;
        state.mobileSidebarOpen = false;
        render();
      });
      root.appendChild(catcher);
    }

    root.appendChild(buildTopbar(accent));

    var mainRow = el('div', 'main-row');
    mainRow.appendChild(buildSidebar(accent));
    mainRow.appendChild(buildBoard(accent));
    root.appendChild(mainRow);

    if (state.templatePickerOpen) root.appendChild(buildTemplatePickerModal(accent));
    if (state.createDialog) root.appendChild(buildCreateDialogModal(accent));
    if (state.confirmDeleteProject) root.appendChild(buildConfirmDeleteModal());
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function icon(name, extraClass) {
    var s = el('span', 'msi' + (extraClass ? ' ' + extraClass : ''), name);
    return s;
  }
  function buildTag(labelText, color) {
    var chip = el('div', 'tile-tag');
    chip.style.setProperty('--tag-color', color);
    chip.appendChild(el('span', 'tile-tag-dot'));
    chip.appendChild(el('span', 'tile-tag-text', labelText));
    return chip;
  }
  function buildAvatar(name, color) {
    var avatar = el('span', 'tile-avatar', (name || '?').charAt(0).toUpperCase());
    avatar.style.background = color;
    return avatar;
  }

  function projectsById() {
    var map = {};
    state.projects.forEach(function (p) { map[p.id] = p; });
    return map;
  }
  function tilesByProject() {
    var map = {};
    state.tiles.forEach(function (t) {
      (map[t.projectId] = map[t.projectId] || []).push(t);
    });
    return map;
  }
  function isProjectDone(projectId) {
    var pts = state.tiles.filter(function (t) { return t.projectId === projectId; });
    return pts.length > 0 && pts.every(function (t) { return t.status === 'done'; });
  }
  function tileNumber(t) {
    var arr = tilesByProject()[t.projectId] || [];
    var idx = arr.indexOf(t);
    return idx === -1 ? null : idx + 1;
  }
  function archiveProject(projectId) {
    var p = projectsById()[projectId];
    if (!p) return;
    p.archived = true;
    persist();
    render();
  }
  function unarchiveProject(projectId) {
    var p = projectsById()[projectId];
    if (!p) return;
    p.archived = false;
    persist();
    render();
  }
  function moveTileToStatusEnd(tileId, status) {
    var idx = state.tiles.findIndex(function (t) { return t.id === tileId; });
    if (idx === -1) return;
    var moved = state.tiles.splice(idx, 1)[0];
    moved.status = status;
    state.tiles.push(moved);
  }

  /* ---------- Top bar ---------- */
  function buildTopbar(accent) {
    var bar = el('div', 'topbar');
    var left = el('div', 'topbar-left');

    var hamburger = el('button', 'hamburger-btn');
    hamburger.appendChild(icon('menu'));
    hamburger.title = 'Toggle projects';
    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      state.mobileSidebarOpen = !state.mobileSidebarOpen;
      state.newProjectOpen = false;
      state.settingsOpen = false;
      state.archivedOpen = false;
      render();
    });
    left.appendChild(hamburger);

    left.appendChild(el('h1', 'app-title', 'nullboard'));

    var wrap = el('div', 'new-project-wrap');
    var btn = el('button', 'new-project-btn');
    btn.appendChild(icon('add'));
    btn.appendChild(el('span', null, 'New Project'));
    btn.appendChild(icon('expand_more'));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.newProjectOpen = !state.newProjectOpen;
      state.settingsOpen = false;
      render();
    });
    wrap.appendChild(btn);

    if (state.newProjectOpen) {
      var panel = el('div', 'menu-panel');
      var blankRow = el('button', 'menu-row');
      blankRow.appendChild(icon('note_add'));
      blankRow.appendChild(document.createTextNode(' Blank Project'));
      blankRow.addEventListener('click', function (e) {
        e.stopPropagation();
        openCreateDialog('blank');
      });
      var tplRow = el('button', 'menu-row');
      tplRow.appendChild(icon('dashboard_customize'));
      tplRow.appendChild(document.createTextNode(' Choose From Template'));
      tplRow.addEventListener('click', function (e) {
        e.stopPropagation();
        state.newProjectOpen = false;
        state.templatePickerOpen = true;
        state.templatePickerMode = 'list';
        render();
      });
      panel.appendChild(blankRow);
      panel.appendChild(tplRow);
      wrap.appendChild(panel);
    }
    left.appendChild(wrap);
    bar.appendChild(left);

    var meta = el('div', 'topbar-meta', state.tiles.length + ' tiles · ' + state.projects.length + ' projects');
    bar.appendChild(meta);
    return bar;
  }

  /* ---------- Sidebar ---------- */
  function buildSidebar(accent) {
    var sidebar = el('div', 'sidebar' + (state.mobileSidebarOpen ? ' mobile-open' : ''));
    var list = el('div', 'sidebar-list');
    list.appendChild(el('div', 'sidebar-heading', 'Projects'));

    var tbp = tilesByProject();
    var visibleProjects = state.projects.filter(function (p) { return !p.archived; });

    if (visibleProjects.length === 0) {
      list.appendChild(el('div', 'no-projects', 'No projects yet.'));
    } else {
      visibleProjects.forEach(function (p) {
        list.appendChild(buildProjectRow(p, tbp[p.id] || []));
      });
    }
    sidebar.appendChild(list);
    sidebar.appendChild(buildSidebarBottom());
    return sidebar;
  }

  function buildProjectRow(p, tiles) {
    var card = el('div', 'project-card');
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', function (e) {
      state.draggingProjectId = p.id;
      state.draggingTileId = null;
      try { e.dataTransfer.setData('text/plain', 'project:' + p.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    card.addEventListener('dragend', function () {
      state.draggingProjectId = null;
      render();
    });
    card.addEventListener('dragenter', function (e) { e.preventDefault(); e.stopPropagation(); });
    card.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (state.draggingTileId) card.classList.add('drag-target');
    });
    card.addEventListener('dragleave', function () { card.classList.remove('drag-target'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drag-target');
      var tileId = state.draggingTileId;
      if (!tileId) return;
      var idx = state.tiles.findIndex(function (t) { return t.id === tileId; });
      if (idx === -1) return;
      var moved = state.tiles.splice(idx, 1)[0];
      moved.projectId = p.id;
      moved.status = null;
      state.tiles.push(moved);
      state.draggingTileId = null;
      state.expandedProjects[p.id] = true;
      persist();
      render();
    });

    var done = isProjectDone(p.id);
    var expanded = !!state.expandedProjects[p.id];

    var topRow = el('div', 'project-row-top');
    var dot = el('span', 'project-dot');
    dot.style.background = p.color;
    topRow.appendChild(dot);

    if (state.renamingProjectId === p.id) {
      var renameInput = el('input', 'dark-input project-rename-input');
      renameInput.value = state.renameProjectDraftText;
      var commitProjectRename = function () {
        var text = state.renameProjectDraftText.trim();
        if (text) p.name = text;
        state.renamingProjectId = null;
        persist();
        render();
      };
      renameInput.addEventListener('click', function (e) { e.stopPropagation(); });
      renameInput.addEventListener('input', function (e) { state.renameProjectDraftText = e.target.value; });
      renameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') commitProjectRename();
        if (e.key === 'Escape') { state.renamingProjectId = null; render(); }
      });
      renameInput.addEventListener('blur', commitProjectRename);
      topRow.appendChild(renameInput);
      setTimeout(function () { renameInput.focus(); renameInput.select(); }, 0);
    } else {
      var nameSpan = el('span', 'project-name' + (done ? ' done' : ''), p.name);
      nameSpan.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        state.renamingProjectId = p.id;
        state.renameProjectDraftText = p.name;
        render();
      });
      topRow.appendChild(nameSpan);
    }

    var chev = icon('chevron_right', 'chevron' + (expanded ? ' expanded' : ''));
    topRow.appendChild(chev);
    topRow.addEventListener('click', function () {
      state.expandedProjects[p.id] = !state.expandedProjects[p.id];
      render();
    });
    card.appendChild(topRow);

    var bottomRow = el('div', 'project-row-bottom');
    bottomRow.appendChild(el('span', 'project-count', String(tiles.length)));
    bottomRow.appendChild(el('span', 'project-row-spacer'));

    var addBtn = el('button', 'icon-btn');
    addBtn.appendChild(icon('add'));
    addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.addTileDraftProjectId = p.id;
      state.addTileDraftText = '';
      state.expandedProjects[p.id] = true;
      render();
    });
    bottomRow.appendChild(addBtn);

    var archiveBtn = el('button', 'icon-btn');
    archiveBtn.title = 'Archive project';
    archiveBtn.appendChild(icon('archive'));
    archiveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      archiveProject(p.id);
    });
    bottomRow.appendChild(archiveBtn);

    var delBtn = el('button', 'icon-btn delete');
    delBtn.appendChild(icon('delete'));
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.confirmDeleteProject = p.id;
      render();
    });
    bottomRow.appendChild(delBtn);
    card.appendChild(bottomRow);

    if (expanded) {
      var listWrap = el('div', 'project-tiles');
      var unplacedTiles = tiles.filter(function (t) { return !t.status; });
      unplacedTiles.forEach(function (t) {
        if (state.renamingTileId === t.id) {
          var renameInput = el('input', 'dark-input mini-tile-rename');
          renameInput.value = state.renameDraftText;
          var commitRename = function () {
            var text = state.renameDraftText.trim();
            if (text) t.title = text;
            state.renamingTileId = null;
            persist();
            render();
          };
          renameInput.addEventListener('input', function (e) { state.renameDraftText = e.target.value; });
          renameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') { state.renamingTileId = null; render(); }
          });
          renameInput.addEventListener('blur', commitRename);
          listWrap.appendChild(renameInput);
          setTimeout(function () { renameInput.focus(); renameInput.select(); }, 0);
          return;
        }

        var mtRow = el('div', 'mini-tile-row');
        var mt = el('div', 'mini-tile');
        var mtDot = el('span', 'mini-tile-dot');
        mtDot.style.background = p.color;
        mt.appendChild(mtDot);
        var num = tiles.indexOf(t) + 1;
        mt.appendChild(el('span', 'mini-tile-number', num + '.'));
        mt.appendChild(el('span', 'mini-tile-text', t.title));
        mt.setAttribute('draggable', 'true');
        mt.addEventListener('dragstart', function (e) {
          state.draggingTileId = t.id;
          try { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
        });
        mt.addEventListener('click', function () {
          state.renamingTileId = t.id;
          state.renameDraftText = t.title;
          render();
        });
        mtRow.appendChild(mt);

        var mtDel = el('button', 'icon-btn delete mini-tile-delete');
        mtDel.appendChild(icon('delete'));
        mtDel.addEventListener('click', function (e) {
          e.stopPropagation();
          state.tiles = state.tiles.filter(function (x) { return x.id !== t.id; });
          persist();
          render();
        });
        mtRow.appendChild(mtDel);

        listWrap.appendChild(mtRow);
      });

      if (state.addTileDraftProjectId === p.id) {
        var input = el('input', 'dark-input add-tile-input');
        input.placeholder = 'Tile title…';
        input.value = state.addTileDraftText;
        input.addEventListener('input', function (e) { state.addTileDraftText = e.target.value; });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') commitAddTileDraft();
          if (e.key === 'Escape') { state.addTileDraftProjectId = null; state.addTileDraftText = ''; render(); }
        });
        input.addEventListener('blur', function () { commitAddTileDraft(); });
        listWrap.appendChild(input);
        setTimeout(function () { input.focus(); }, 0);
      }
      card.appendChild(listWrap);
    }
    return card;
  }

  function commitAddTileDraft() {
    var projectId = state.addTileDraftProjectId;
    var text = state.addTileDraftText.trim();
    if (!projectId) return;
    if (!text) {
      state.addTileDraftProjectId = null;
      state.addTileDraftText = '';
      render();
      return;
    }
    state.tiles.push({ id: uid('tile'), projectId: projectId, title: text, status: null, notes: [] });
    state.addTileDraftProjectId = null;
    state.addTileDraftText = '';
    persist();
    render();
  }

  function buildSidebarBottom() {
    var bottom = el('div', 'sidebar-bottom');
    var row = el('div', 'sidebar-bottom-row');
    var btn = el('button', 'settings-btn');
    btn.appendChild(icon('settings'));
    btn.appendChild(el('span', null, 'Settings'));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.settingsOpen = !state.settingsOpen;
      state.newProjectOpen = false;
      state.archivedOpen = false;
      render();
    });
    row.appendChild(btn);

    var archivedBtn = el('button', 'archived-btn', 'Archived');
    archivedBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.archivedOpen = !state.archivedOpen;
      state.settingsOpen = false;
      render();
    });
    row.appendChild(archivedBtn);
    bottom.appendChild(row);

    if (state.archivedOpen) {
      var archPop = el('div', 'settings-popover');
      archPop.addEventListener('click', function (e) { e.stopPropagation(); });
      archPop.appendChild(el('div', 'settings-label', 'Archived Projects'));
      var archivedProjects = state.projects.filter(function (p) { return p.archived; });
      if (archivedProjects.length === 0) {
        archPop.appendChild(el('div', 'no-projects', 'No archived projects.'));
      } else {
        var archList = el('div', 'archived-list');
        archivedProjects.forEach(function (p) {
          var arow = el('div', 'archived-row');
          var adot = el('span', 'project-dot');
          adot.style.background = p.color;
          arow.appendChild(adot);
          arow.appendChild(el('span', 'project-name', p.name));
          var unarchiveBtn = el('button', 'unarchive-btn', 'Unarchive');
          unarchiveBtn.addEventListener('click', function () { unarchiveProject(p.id); });
          arow.appendChild(unarchiveBtn);
          archList.appendChild(arow);
        });
        archPop.appendChild(archList);
      }
      bottom.appendChild(archPop);
    }

    if (state.settingsOpen) {
      var pop = el('div', 'settings-popover');
      pop.addEventListener('click', function (e) { e.stopPropagation(); });
      pop.appendChild(el('div', 'settings-label', 'Theme'));
      var row = el('div', 'theme-row');
      Object.keys(THEMES).forEach(function (key) {
        var t = THEMES[key];
        var swatch = el('button', 'theme-swatch');
        swatch.style.background = t.accent;
        swatch.title = t.label;
        var selected = state.theme === key;
        swatch.style.borderColor = selected ? '#eae8ea' : 'transparent';
        if (selected) swatch.appendChild(icon('check'));
        swatch.addEventListener('click', function () {
          state.theme = key;
          persist();
          render();
        });
        row.appendChild(swatch);
      });
      pop.appendChild(row);

      pop.appendChild(el('div', 'settings-label', 'Font Size'));
      var sizeRow = el('div', 'fontsize-row');
      FONT_SIZES.forEach(function (fs) {
        var sizeBtn = el('button', 'fontsize-btn' + (state.fontSize === fs.key ? ' active' : ''), fs.label);
        sizeBtn.addEventListener('click', function () {
          state.fontSize = fs.key;
          persist();
          render();
        });
        sizeRow.appendChild(sizeBtn);
      });
      pop.appendChild(sizeRow);

      var clearBtn = el('button', 'clear-board-btn', 'Clear Board');
      clearBtn.addEventListener('click', function () {
        if (!window.confirm('Clear all projects and tiles? Templates and theme are kept.')) return;
        state.projects = [];
        state.tiles = [];
        state.expandedProjects = {};
        state.expandedTiles = {};
        persist();
        render();
      });
      pop.appendChild(clearBtn);
      bottom.appendChild(pop);
    }
    return bottom;
  }

  /* ---------- Board ---------- */
  function buildBoard(accent) {
    var board = el('div', 'board');
    COLUMNS.forEach(function (col) {
      board.appendChild(buildColumn(col, accent));
    });
    return board;
  }

  function buildColumn(col, accent) {
    var pbid = projectsById();
    var visibleTiles = state.tiles.filter(function (t) {
      var p = pbid[t.projectId];
      return p && !p.archived;
    });
    var colTiles = visibleTiles.filter(function (t) { return t.status === col.key; });
    var column = el('div', 'column');
    column.addEventListener('dragenter', function (e) { e.preventDefault(); });
    column.addEventListener('dragover', function (e) { e.preventDefault(); column.classList.add('drag-over'); });
    column.addEventListener('dragleave', function () { column.classList.remove('drag-over'); });
    column.addEventListener('drop', function (e) {
      e.preventDefault();
      column.classList.remove('drag-over');
      if (state.draggingProjectId) {
        var pid = state.draggingProjectId;
        var projTiles = state.tiles.filter(function (t) { return t.projectId === pid; });
        var others = state.tiles.filter(function (t) { return t.projectId !== pid; });
        projTiles.forEach(function (t) { t.status = col.key; });
        state.tiles = others.concat(projTiles);
        state.draggingProjectId = null;
        persist();
        render();
        return;
      }
      var tileId = state.draggingTileId;
      if (!tileId) return;
      moveTileToStatusEnd(tileId, col.key);
      state.draggingTileId = null;
      persist();
      render();
    });

    var header = el('div', 'column-header');
    var headerLeft = el('div', 'column-header-left');
    var colDot = el('span', 'column-dot');
    colDot.style.background = col.color;
    headerLeft.appendChild(colDot);
    headerLeft.appendChild(el('span', 'column-label', col.label));
    header.appendChild(headerLeft);
    header.appendChild(el('span', 'column-count', String(colTiles.length)));
    column.appendChild(header);

    var body = el('div', 'column-body');
    if (colTiles.length === 0) {
      body.appendChild(el('div', 'empty-col', 'Empty'));
    } else if (col.key === 'done') {
      renderCompletedTiles(body, colTiles, pbid);
    } else {
      colTiles.forEach(function (t) {
        body.appendChild(buildTile(t, pbid[t.projectId] || { color: '#75798c' }));
      });
    }
    column.appendChild(body);
    return column;
  }

  function renderCompletedTiles(body, colTiles, pbid) {
    var emittedProjects = {};
    colTiles.forEach(function (t) {
      var project = pbid[t.projectId] || { color: '#75798c' };
      if (isProjectDone(t.projectId)) {
        if (emittedProjects[t.projectId]) return;
        emittedProjects[t.projectId] = true;
        body.appendChild(buildCompletedGroup(project, colTiles.filter(function (x) { return x.projectId === t.projectId; })));
      } else {
        body.appendChild(buildTile(t, project));
      }
    });
  }

  function buildCompletedGroup(project, groupTiles) {
    var group = el('div', 'tile completed-group');

    var head = el('div', 'tile-head');
    var titleWrap = el('div', 'tile-title-wrap');
    titleWrap.appendChild(buildAvatar(project.name, project.color));
    var titleCol = el('div', 'tile-title-col');
    titleCol.appendChild(el('div', 'tile-title done', project.name));
    titleCol.appendChild(el('div', 'completed-group-sub', groupTiles.length + ' completed'));
    titleWrap.appendChild(titleCol);
    head.appendChild(titleWrap);

    var archiveBtn = el('button', 'tile-edit');
    archiveBtn.title = 'Archive project';
    archiveBtn.appendChild(icon('archive'));
    archiveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      archiveProject(project.id);
    });
    head.appendChild(archiveBtn);
    group.appendChild(head);

    var groupBody = el('div', 'completed-group-tiles');
    groupTiles.forEach(function (t) {
      var row = el('div', 'completed-group-row');
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', function (e) {
        state.draggingTileId = t.id;
        try { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
      });
      row.addEventListener('dragend', function () {
        state.draggingTileId = null;
        render();
      });
      row.appendChild(icon('drag_indicator', 'drag-indicator'));
      var groupNum = tileNumber(t);
      if (groupNum) row.appendChild(el('span', 'completed-group-row-number', groupNum + '.'));
      row.appendChild(el('span', 'completed-group-row-text', t.title));
      var delBtn = el('button', 'tile-delete');
      delBtn.appendChild(icon('close'));
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        state.tiles = state.tiles.filter(function (x) { return x.id !== t.id; });
        persist();
        render();
      });
      row.appendChild(delBtn);
      groupBody.appendChild(row);
    });
    group.appendChild(groupBody);
    return group;
  }

  function buildTile(t, project) {
    var expanded = !!state.expandedTiles[t.id];

    var tile = el('div', 'tile' + (state.pulseTileId === t.id ? ' tile-pulse' : ''));
    tile.setAttribute('draggable', 'true');

    tile.addEventListener('dragstart', function (e) {
      state.draggingTileId = t.id;
      try { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    tile.addEventListener('dragend', function () {
      state.draggingTileId = null;
      render();
    });
    tile.addEventListener('dragenter', function (e) { e.preventDefault(); e.stopPropagation(); });
    tile.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); });
    tile.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleDropOnTileReorder(t.id);
    });

    var head = el('div', 'tile-head');
    var titleWrap = el('div', 'tile-title-wrap');
    var titleCol = el('div', 'tile-title-col');
    var num = tileNumber(t);
    var labelText = project.name ? (num ? project.name + '  ·  #' + num : project.name) : (num ? '#' + num : '');

    if (state.renamingTileId === t.id) {
      if (labelText) titleCol.appendChild(buildTag(labelText, project.color));
      var renameInput = el('input', 'dark-input tile-rename-input');
      renameInput.value = state.renameDraftText;
      var commitTileRename = function () {
        var text = state.renameDraftText.trim();
        if (text) t.title = text;
        state.renamingTileId = null;
        persist();
        render();
      };
      renameInput.addEventListener('click', function (e) { e.stopPropagation(); });
      renameInput.addEventListener('input', function (e) { state.renameDraftText = e.target.value; });
      renameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') commitTileRename();
        if (e.key === 'Escape') { state.renamingTileId = null; render(); }
      });
      renameInput.addEventListener('blur', commitTileRename);
      titleCol.appendChild(renameInput);
      setTimeout(function () { renameInput.focus(); renameInput.select(); }, 0);
    } else {
      if (labelText) titleCol.appendChild(buildTag(labelText, project.color));
      titleCol.appendChild(el('div', 'tile-title' + (t.status === 'done' ? ' done' : ''), t.title));
      var noteCount = (t.notes || []).length;
      if (noteCount > 0) {
        var footer = el('div', 'tile-footer');
        var noteBadge = el('span', 'tile-note-badge');
        noteBadge.title = noteCount + ' note' + (noteCount === 1 ? '' : 's');
        noteBadge.appendChild(icon('sticky_note_2'));
        noteBadge.appendChild(el('span', 'tile-note-badge-count', String(noteCount)));
        footer.appendChild(noteBadge);
        titleCol.appendChild(footer);
      }
      titleWrap.addEventListener('click', function () {
        state.expandedTiles[t.id] = !state.expandedTiles[t.id];
        render();
      });
      titleWrap.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        state.renamingTileId = t.id;
        state.renameDraftText = t.title;
        render();
      });
    }
    titleWrap.appendChild(titleCol);
    head.appendChild(titleWrap);

    var editBtn = el('button', 'tile-edit');
    editBtn.title = 'Rename';
    editBtn.appendChild(icon('edit'));
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.renamingTileId = t.id;
      state.renameDraftText = t.title;
      render();
    });
    head.appendChild(editBtn);
    head.appendChild(icon('drag_indicator', 'drag-indicator'));

    var delBtn = el('button', 'tile-delete');
    delBtn.appendChild(icon('close'));
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.tiles = state.tiles.filter(function (x) { return x.id !== t.id; });
      persist();
      render();
    });
    head.appendChild(delBtn);
    tile.appendChild(head);

    if (expanded) {
      var notesWrap = el('div', 'tile-notes');
      var notes = t.notes || [];
      notes.forEach(function (note) {
        var noteRow = el('div', 'tile-note-row');
        noteRow.appendChild(el('span', 'tile-note-text', note.text));
        var noteDel = el('button', 'tile-note-delete');
        noteDel.appendChild(icon('close'));
        noteDel.addEventListener('click', function () {
          t.notes = (t.notes || []).filter(function (n) { return n.id !== note.id; });
          persist();
          render();
        });
        noteRow.appendChild(noteDel);
        notesWrap.appendChild(noteRow);
      });

      var addNoteRow = el('div', 'add-note-row');
      var addNoteInput = el('input', 'add-note-input');
      addNoteInput.placeholder = 'Add note…';
      addNoteInput.value = state.newNoteDraftByTile[t.id] || '';
      addNoteInput.addEventListener('input', function (e) {
        state.newNoteDraftByTile[t.id] = e.target.value;
      });
      var doAddNote = function () {
        var text = (state.newNoteDraftByTile[t.id] || '').trim();
        if (!text) return;
        if (!t.notes) t.notes = [];
        t.notes.push({ id: uid('note'), text: text });
        state.newNoteDraftByTile[t.id] = '';
        persist();
        render();
      };
      addNoteInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAddNote(); });
      addNoteRow.appendChild(addNoteInput);
      var addNoteBtn = el('button', 'add-note-btn');
      addNoteBtn.style.color = project.color;
      addNoteBtn.appendChild(icon('add'));
      addNoteBtn.addEventListener('click', doAddNote);
      addNoteRow.appendChild(addNoteBtn);
      notesWrap.appendChild(addNoteRow);
      tile.appendChild(notesWrap);
    }

    return tile;
  }

  function handleDropOnTileReorder(targetTileId) {
    var tileId = state.draggingTileId;
    if (!tileId || tileId === targetTileId) {
      state.draggingTileId = null;
      render();
      return;
    }
    var tiles = state.tiles.slice();
    var fromIdx = tiles.findIndex(function (t) { return t.id === tileId; });
    if (fromIdx === -1) {
      state.draggingTileId = null;
      render();
      return;
    }
    var moved = tiles.splice(fromIdx, 1)[0];
    var targetIdx = tiles.findIndex(function (t) { return t.id === targetTileId; });
    var targetStatus = tiles[targetIdx] ? tiles[targetIdx].status : moved.status;
    moved.status = targetStatus;
    var insertAt = targetIdx === -1 ? tiles.length : targetIdx;
    tiles.splice(insertAt, 0, moved);
    state.tiles = tiles;
    state.draggingTileId = null;
    persist();
    render();
  }

  /* ---------- Create Dialog ---------- */
  function openCreateDialog(source) {
    state.newProjectOpen = false;
    state.templatePickerOpen = false;
    state.createDialog = { source: source, name: '', color: PROJECT_COLORS[0] };
    render();
  }

  function buildCreateDialogModal(accent) {
    var backdrop = el('div', 'modal-backdrop modal-create');
    backdrop.addEventListener('click', function () { state.createDialog = null; render(); });
    var modal = el('div', 'modal');
    modal.addEventListener('click', function (e) { e.stopPropagation(); });

    modal.appendChild(el('h2', 'modal-title', 'New Project'));

    var nameGroup = el('div', 'field-group');
    nameGroup.appendChild(el('label', 'field-label', 'Project Name'));
    var nameInput = el('input', 'field-input');
    nameInput.placeholder = 'e.g. West Wing Renovation';
    nameInput.value = state.createDialog.name;
    nameInput.addEventListener('input', function (e) {
      state.createDialog.name = e.target.value;
      updateCreateButtons();
    });
    nameGroup.appendChild(nameInput);
    modal.appendChild(nameGroup);
    setTimeout(function () { nameInput.focus(); }, 0);

    var colorGroup = el('div', 'field-group');
    colorGroup.appendChild(el('label', 'field-label', 'Color'));
    var colorRow = el('div', 'color-row');
    PROJECT_COLORS.forEach(function (c) {
      var sw = el('button', 'color-swatch');
      sw.style.background = c;
      sw.style.borderColor = state.createDialog.color === c ? '#eae8ea' : 'transparent';
      sw.addEventListener('click', function () {
        state.createDialog.color = c;
        render();
      });
      colorRow.appendChild(sw);
    });
    colorGroup.appendChild(colorRow);
    modal.appendChild(colorGroup);

    var cd = state.createDialog;
    if (cd.source !== 'blank') {
      var tpl = state.templates.find(function (x) { return x.id === cd.source; });
      if (tpl) {
        var previewWrap = el('div');
        previewWrap.appendChild(el('div', 'field-label', 'Will create:'));
        var pl = el('div', 'preview-list');
        tpl.tiles.forEach(function (x) {
          var row = el('div', 'preview-row');
          row.appendChild(el('span', null, x.title));
          pl.appendChild(row);
        });
        previewWrap.appendChild(pl);
        modal.appendChild(previewWrap);
      }
    }

    var footer = el('div', 'modal-footer');
    var cancelBtn = el('button', 'btn-outline', 'Cancel');
    cancelBtn.addEventListener('click', function () { state.createDialog = null; render(); });
    var createBtn = el('button', 'btn-accent', 'Create');
    createBtn.disabled = !cd.name.trim();
    createBtn.addEventListener('click', function () { doCreateProject(); });
    footer.appendChild(cancelBtn);
    footer.appendChild(createBtn);
    modal.appendChild(footer);

    function updateCreateButtons() {
      createBtn.disabled = !state.createDialog.name.trim();
    }

    backdrop.appendChild(modal);
    return backdrop;
  }

  function doCreateProject() {
    var cd = state.createDialog;
    if (!cd || !cd.name.trim()) return;
    var projectId = uid('proj');
    var project = { id: projectId, name: cd.name.trim(), color: cd.color };
    var newTiles = [];
    if (cd.source !== 'blank') {
      var tpl = state.templates.find(function (t) { return t.id === cd.source; });
      if (tpl) {
        tpl.tiles.forEach(function (row) {
          newTiles.push({
            id: uid('tile'), projectId: projectId, title: row.title, status: null, notes: [],
          });
        });
      }
    }
    state.projects.push(project);
    state.tiles = state.tiles.concat(newTiles);
    state.expandedProjects[projectId] = true;
    state.createDialog = null;
    persist();
    render();
  }

  /* ---------- Template Picker ---------- */
  function buildTemplatePickerModal(accent) {
    var backdrop = el('div', 'modal-backdrop modal-template-picker');
    backdrop.addEventListener('click', function () {
      state.templatePickerOpen = false;
      state.templatePickerMode = 'list';
      state.templateDraft = null;
      render();
    });
    var modal = el('div', 'modal');
    modal.addEventListener('click', function (e) { e.stopPropagation(); });

    if (state.templatePickerMode === 'list') {
      var header = el('div', 'modal-header');
      header.appendChild(el('h2', 'modal-title', 'Choose a Template'));
      var closeBtn = el('button', 'modal-close');
      closeBtn.appendChild(icon('close'));
      closeBtn.addEventListener('click', function () {
        state.templatePickerOpen = false;
        state.templatePickerMode = 'list';
        render();
      });
      header.appendChild(closeBtn);
      modal.appendChild(header);

      var grid = el('div', 'template-grid');
      state.templates.forEach(function (tpl) {
        var card = el('div', 'template-card');
        card.appendChild(el('div', 'template-name', tpl.name));
        card.appendChild(el('div', 'template-count', tpl.tiles.length + ' tiles'));
        card.appendChild(el('div', 'template-preview', tpl.tiles.slice(0, 4).map(function (x) { return x.title; }).join(' · ')));
        var delBtn = el('button', 'template-delete');
        delBtn.appendChild(icon('delete'));
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          state.templates = state.templates.filter(function (t) { return t.id !== tpl.id; });
          persist();
          render();
        });
        card.appendChild(delBtn);
        card.addEventListener('click', function () { openCreateDialog(tpl.id); });
        grid.appendChild(card);
      });

      var addCard = el('div', 'add-template-card');
      addCard.appendChild(icon('add'));
      addCard.appendChild(el('span', null, 'Add Template'));
      addCard.addEventListener('click', function () {
        state.templatePickerMode = 'add';
        state.templateDraft = { name: '', tiles: [{ title: '' }] };
        render();
      });
      grid.appendChild(addCard);
      modal.appendChild(grid);
    } else {
      modal.appendChild(buildTemplateAddForm(accent));
    }

    backdrop.appendChild(modal);
    return backdrop;
  }

  function buildTemplateAddForm(accent) {
    var wrap = el('div');
    var header = el('div', 'modal-header');
    header.appendChild(el('h2', 'modal-title', 'New Template'));
    var closeBtn = el('button', 'modal-close');
    closeBtn.appendChild(icon('close'));
    closeBtn.addEventListener('click', function () {
      state.templatePickerMode = 'list';
      state.templateDraft = null;
      render();
    });
    header.appendChild(closeBtn);
    wrap.appendChild(header);

    var nameGroup = el('div', 'field-group');
    nameGroup.appendChild(el('label', 'field-label', 'Template Name'));
    var nameInput = el('input', 'field-input');
    nameInput.placeholder = 'e.g. Website Launch';
    nameInput.value = state.templateDraft.name;
    nameInput.addEventListener('input', function (e) {
      state.templateDraft.name = e.target.value;
      updateSaveBtn();
    });
    nameGroup.appendChild(nameInput);
    wrap.appendChild(nameGroup);

    var rows = el('div', 'template-rows');
    state.templateDraft.tiles.forEach(function (row, idx) {
      var rowEl = el('div', 'template-row');
      var titleInput = el('input', 'template-row-title');
      titleInput.placeholder = 'Tile title';
      titleInput.value = row.title;
      titleInput.addEventListener('input', function (e) {
        row.title = e.target.value;
        updateSaveBtn();
      });
      rowEl.appendChild(titleInput);

      if (state.templateDraft.tiles.length > 1) {
        var rmBtn = el('button', 'template-row-remove');
        rmBtn.appendChild(icon('delete'));
        rmBtn.addEventListener('click', function () {
          state.templateDraft.tiles = state.templateDraft.tiles.filter(function (_, i) { return i !== idx; });
          if (!state.templateDraft.tiles.length) state.templateDraft.tiles = [{ title: '' }];
          render();
        });
        rowEl.appendChild(rmBtn);
      }
      rows.appendChild(rowEl);
    });
    wrap.appendChild(rows);

    var addTileBtn = el('button', 'add-tile-row-btn');
    addTileBtn.appendChild(icon('add'));
    addTileBtn.appendChild(document.createTextNode(' Add Tile'));
    addTileBtn.addEventListener('click', function () {
      state.templateDraft.tiles.push({ title: '' });
      render();
    });
    wrap.appendChild(addTileBtn);

    var footer = el('div', 'modal-footer');
    var cancelBtn = el('button', 'btn-outline', 'Cancel');
    cancelBtn.addEventListener('click', function () {
      state.templatePickerMode = 'list';
      state.templateDraft = null;
      render();
    });
    var saveBtn = el('button', 'btn-accent', 'Save Template');
    saveBtn.disabled = !canSaveTemplate();
    saveBtn.addEventListener('click', function () { doSaveTemplate(); });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    wrap.appendChild(footer);

    function updateSaveBtn() {
      saveBtn.disabled = !canSaveTemplate();
    }

    return wrap;
  }

  function canSaveTemplate() {
    var d = state.templateDraft;
    return !!(d && d.name.trim() && d.tiles.some(function (t) { return t.title.trim(); }));
  }

  function doSaveTemplate() {
    var draft = state.templateDraft;
    if (!draft || !draft.name.trim()) return;
    var tiles = draft.tiles.filter(function (t) { return t.title.trim(); }).map(function (t) {
      return { title: t.title.trim() };
    });
    if (!tiles.length) return;
    state.templates.push({ id: uid('tpl'), name: draft.name.trim(), tiles: tiles });
    state.templatePickerMode = 'list';
    state.templateDraft = null;
    persist();
    render();
  }

  /* ---------- Confirm delete project ---------- */
  function buildConfirmDeleteModal() {
    var backdrop = el('div', 'modal-backdrop modal-confirm-delete');
    var modal = el('div', 'modal');
    modal.addEventListener('click', function (e) { e.stopPropagation(); });

    var pbid = projectsById();
    var p = pbid[state.confirmDeleteProject];
    var count = state.tiles.filter(function (t) { return t.projectId === state.confirmDeleteProject; }).length;

    modal.appendChild(el('h2', 'modal-title', 'Delete “' + (p ? p.name : '') + '”?'));
    modal.appendChild(el('p', 'confirm-body', 'This removes the project and its ' + count + ' tiles. This cannot be undone.'));

    var footer = el('div', 'modal-footer');
    var cancelBtn = el('button', 'btn-outline', 'Cancel');
    cancelBtn.addEventListener('click', function () { state.confirmDeleteProject = null; render(); });
    var delBtn = el('button', 'btn-danger-outline', 'Delete');
    delBtn.addEventListener('click', function () {
      var id = state.confirmDeleteProject;
      state.projects = state.projects.filter(function (p) { return p.id !== id; });
      state.tiles = state.tiles.filter(function (t) { return t.projectId !== id; });
      state.confirmDeleteProject = null;
      persist();
      render();
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(delBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    return backdrop;
  }

  load();
  render();
})();
