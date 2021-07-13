Zotero.Jasminum = {
    init: async function () {
        // Register the callback in Zotero as an item observer
        var notifierID = Zotero.Notifier.registerObserver(
            Zotero.Jasminum.notifierCallback,
            ["item"]
        );
        // Unregister callback when the window closes (important to avoid a memory leak)
        window.addEventListener(
            "unload",
            function (e) {
                Zotero.Notifier.unregisterObserver(notifierID);
            },
            false
        );
        // 等待数据维护更新完毕
        // await Zotero.Schema.schemaUpdatePromise;
        Zotero.Jasminum.userAgent =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.77 Safari/537.36";
        Zotero.Jasminum.initPref();
        Components.utils.import("resource://gre/modules/osfile.jsm");
        Zotero.Jasminum.CNDB = ["CNKI"];
        Zotero.debug("Init Jasminum ...");
    },

    initPref: function () {
        if (Zotero.Prefs.get("jasminum.pdftkpath") === undefined) {
            var pdftkpath = "C:\\Program Files (x86)\\PDFtk Server\\bin";
            if (Zotero.isLinux) {
                pdftkpath = "/usr/bin";
            } else if (Zotero.isMac) {
                pdftkpath = "/opt/pdflabs/pdftk/bin";
            }
            Zotero.Prefs.set("jasminum.pdftkpath", pdftkpath);
        }
        if (Zotero.Prefs.get("jasminum.autoupdate") === undefined) {
            Zotero.Prefs.set("jasminum.autoupdate", false);
        }
        if (Zotero.Prefs.get("jasminum.namepatent") === undefined) {
            Zotero.Prefs.set("jasminum.namepatent", "{%t}_{%g}");
        }
        if (Zotero.Prefs.get("jasminum.zhnamesplit") === undefined) {
            Zotero.Prefs.set("jasminum.zhnamesplit", true);
        }
        if (Zotero.Prefs.get("jasminum.rename") === undefined) {
            Zotero.Prefs.set("jasminum.rename", true);
        }
        if (Zotero.Prefs.get("jasminum.autobookmark") === undefined) {
            Zotero.Prefs.set("jasminum.autobookmark", true);
        }
    },

    notifierCallback: {
        // Check new added item, and adds meta data.
        notify: async function (event, type, ids, extraData) {
            // var automatic_pdf_download_bool = Zotero.Prefs.get('zoteroscihub.automatic_pdf_download');
            if (event == "add") {
                // Auto update meta data
                var addedItems = Zotero.Items.get(ids);
                if (Zotero.Prefs.get("jasminum.autoupdate")) {
                    Zotero.debug("** Jasminum new items added.");
                    var items = [];
                    for (let item of addedItems) {
                        if (Zotero.Jasminum.checkItem(item)) {
                            items.push(item);
                        }
                    }
                    Zotero.debug(`** Jasminum add ${items.length} items`);
                    Zotero.Jasminum.updateItems(items);
                }
                // Split or merge name
                if (!Zotero.Prefs.get("jasminum.zhnamesplit")) {
                    Zotero.debug("** Jasminum merge CN name");
                    var items = [];
                    for (let item of addedItems) {
                        if (
                            Zotero.Jasminum.CNDB.includes(
                                item.getField("libraryCatalog")
                            )
                        ) {
                            items.push(item);
                        }
                    }
                    Zotero.Jasminum.mergeName(items);
                }
                // Add bookmark after new PDF is attached.
                if (Zotero.Prefs.get("jasminum.autobookmark")) {
                    for (let item of addedItems) {
                        if (
                            item.parentID &&
                            Zotero.ItemTypes.getName(
                                item.parentItem.itemTypeID
                            ) == "thesis" &&
                            item.parentItem.getField("libraryCatalog") ==
                            "CNKI" &&
                            item.attachmentContentType == "application/pdf"
                        ) {
                            Zotero.debug("***** New PDF item is added");
                            await Zotero.Jasminum.addBookmarkItem(item);
                        }
                    }
                }
            }
        },
    },

    displayMenuitem: function () {
        var pane = Services.wm.getMostRecentWindow("navigator:browser")
            .ZoteroPane;
        var items = pane.getSelectedItems();
        Zotero.debug("**Jasminum selected item length: " + items.length);
        var showMenu = items.some((item) => Zotero.Jasminum.checkItem(item));
        pane.document.getElementById(
            "zotero-itemmenu-jasminum"
        ).hidden = !showMenu;
        var showMenuName = items.some((item) =>
            Zotero.Jasminum.checkItemName(item)
        );
        pane.document.getElementById(
            "zotero-itemmenu-jasminum-namehandler"
        ).hidden = !showMenuName;
        var showMenuPDF = false;
        if (items.length === 1) {
            showMenuPDF = Zotero.Jasminum.checkItemPDF(items[0]);
            Zotero.debug("** Jasminum show menu PDF: " + showMenuPDF);
            pane.document.getElementById(
                "zotero-itemmenu-jasminum-bookmark"
            ).hidden = !showMenuPDF;
        }
        pane.document.getElementById("id-jasminum-separator").hidden = !(
            showMenu ||
            showMenuPDF ||
            showMenuName
        );
        Zotero.debug(
            "**Jasminum show menu: " + showMenu + showMenuName + showMenuPDF
        );
    },

    updateSelectedEntity: function (libraryId) {
        Zotero.debug("**Jasminum Updating items in entity");
        if (!ZoteroPane.canEdit()) {
            ZoteroPane.displayCannotEditLibraryMessage();
            return;
        }

        var collection = ZoteroPane.getSelectedCollection(false);

        if (collection) {
            Zotero.debug(
                "**Jasminum Updating items in entity: Is a collection == true"
            );
            var items = [];
            collection.getChildItems(false, false).forEach(function (item) {
                items.push(item);
            });
            suppress_warnings = true;
            Zotero.Jasminum.updateItems(items, suppress_warnings);
        }
    },

    updateSelectedItems: function () {
        Zotero.debug("**Jasminum Updating Selected items");
        Zotero.Jasminum.updateItems(ZoteroPane.getSelectedItems());
    },

    checkItem: function (item) {
        // Return true, when item is OK for update cnki data.
        if (
            !item.isAttachment() ||
            item.isRegularItem() ||
            !item.isTopLevelItem()
        ) {
            return false;
        }

        var filename = item.getFilename();
        // Find Chinese characters in string
        if (escape(filename).indexOf("%u") < 0) return false;
        // Extension should be CAJ or PDF
        var ext = filename.substr(filename.length - 3, 3);
        if (ext != "pdf" && ext != "caj") return false;
        return true;
    },

    splitFilename: function (filename) {
        // Make query parameters from filename
        var patent = Zotero.Prefs.get("jasminum.namepatent");
        var patentSepArr = patent.split(/{%[^}]+}/);
        var patentSepRegArr = patentSepArr.map(x => x.replace(/([\[\\\^\$\.\|\?\*\+\(\)])/g, '\\$&'));
        var patentMainArr = patent.match(/{%[^}]+}/g);
        //文件名中的作者姓名字段里不能包含下划线，请使用“&,，”等字符分隔多个作者，或仅使用第一个作者名（加不加“等”都行）。
        var patentMainRegArr = patentMainArr.map(x => x.replace(/.+/, /{%y}/.test(x) ? '(\\d+)' : (/{%g}/.test(x) ? '([^_]+)' : '(.+)')));
        var regStrInterArr = patentSepRegArr.map((_, i) => [patentSepRegArr[i], patentMainRegArr[i]]);
        var patentReg = new RegExp([].concat.apply([], regStrInterArr).filter(Boolean).join(''), 'g');
        var prefix = filename.substr(0, filename.length - 4);
        var prefix = prefix.replace(/\.ashx$/g, ""); // 删除末尾.ashx字符
        var prefixMainArr = patentReg.exec(prefix);
        // 文件名识别结果为空，跳出警告弹窗
        if (prefixMainArr === null) {
            alert("文件名识别出错，请检查文件名识别模板与实际抓取文件名")
        }
        var titleIdx = patentMainArr.indexOf('{%t}');
        var authorIdx = patentMainArr.indexOf('{%g}');
        var titleRaw = (titleIdx != -1) ? prefixMainArr[titleIdx + 1] : '';
        var authors = (authorIdx != -1) ? prefixMainArr[authorIdx + 1] : '';
        var authorArr = authors.split(/[,，&]/);
        var author = authorArr[0]
        if (authorArr.length == 1) {
            //删除名字后可能出现的“等”字，此处未能做到识别该字是否属于作者姓名。
            //这种处理方式的问题：假如作者名最后一个字为“等”，例如：“刘等”，此时会造成误删。
            //于是对字符数进行判断，保证删除“等”后，至少还剩两个字符，尽可能地避免误删。

            author = (author.endsWith('等') && author.length > 2) ? author.substr(0, author.length - 1) : author;
        }

        //为了避免文件名中的标题字段里存在如下两种情况而导致的搜索失败:
        //原标题过长，文件名出现“_省略_”；
        //原标题有特殊符号（如希腊字母、上下标）导致的标题变动，此时标题也会出现“_”。
        //于是只取用标题中用“_”分割之后的最长的部分作为用于搜索的标题。

        //这种处理方式的问题：假如“最长的部分”中存在知网改写的部分，也可能搜索失败。
        //不过这只是理论上可能存在的情形，目前还未实际遇到。

        var title;

        if (/_/.test(titleRaw)) {

            //getLongestText函数，用于拿到字符串数组中的最长字符
            //摘自https://stackoverflow.com/a/59935726
            const getLongestText = (arr) => arr.reduce(
                (savedText, text) => (text.length > savedText.length ? text : savedText),
                '',
            );
            title = getLongestText(titleRaw.split(/_/));
        } else {
            title = titleRaw;
        }

        return {
            author: author,
            keyword: title,
        };
    },

    // Cookie for search
    setCookieSandbox: function () {
        var cookieData =
            "Ecp_ClientId=1200104193103044969; RsPerPage=20; " +
            "cnkiUserKey=60c42f4d-35a2-6d3f-6efc-ad01eaffd4c3; " +
            "_pk_ref=%5B%22%22%2C%22%22%2C1604497317%2C%22https%3A%2F%2Fcnki.net%2F%22%5D; " +
            "ASP.NET_SessionId=zcw1abnl5vitqcliiq5almmj; " +
            "SID_kns8=123121; " +
            "Ecp_IpLoginFail=20110839.182.10.65";
        var userAgent = Zotero.Jasminum.userAgent;
        var url = "https://cnki.net/";
        var sandbox = new Zotero.CookieSandbox("", url, cookieData, userAgent);
        Zotero.Jasminum.CookieSandbox = sandbox;
    },

    // Cookie for getting Refworks data
    setRefCookieSandbox: function () {
        var cookieData =
            "Ecp_ClientId=1200104193103044969; RsPerPage=20; " +
            "cnkiUserKey=60c42f4d-35a2-6d3f-6efc-ad01eaffd4c3; " +
            "ASP.NET_SessionId=zcw1abnl5vitqcliiq5almmj; " +
            "SID_kns8=123121; Ecp_IpLoginFail=20110839.182.10.65; " +
            "SID_recommendapi=125144; CurrSortFieldType=desc; " +
            "SID_kns=025123117; " +
            "CurrSortField=%e5%8f%91%e8%a1%a8%e6%97%b6%e9%97%b4%2f(%e5%8f%91%e8%a1%a8%e6%97%b6%e9%97%b4%2c%27TIME%27); " +
            "SID_kcms=124117; " +
            "_pk_ref=%5B%22%22%2C%22%22%2C1604847086%2C%22https%3A%2F%2Fcnki.net%2F%22%5D; " +
            "_pk_ses=*";
        var userAgent = Zotero.Jasminum.userAgent;
        var url = "https://cnki.net/";
        var sandbox = new Zotero.CookieSandbox("", url, cookieData, userAgent);
        Zotero.Jasminum.RefCookieSandbox = sandbox;
    },

    createPostData: function (fileData) {
        var queryJson = {
            Platform: "",
            DBCode: "SCDB",
            KuaKuCode:
                "CJFQ,CDMD,CIPD,CCND,CYFD,SCOD,CISD,SNAD,BDZK,GXDB_SECTION,CJFN,CCJD",
            QNode: {
                QGroup: [
                    {
                        Key: "Subject",
                        Title: "",
                        Logic: 4,
                        Items: [],
                        ChildItems: [],
                    },
                    {
                        Key: "ControlGroup",
                        Title: "",
                        Logic: 1,
                        Items: [],
                        ChildItems: [],
                    },
                    {
                        Key: "NaviParam",
                        Title: "",
                        Logic: 1,
                        Items: [
                            {
                                Key: "navi",
                                Title: "",
                                Logic: 1,
                                Name: "专题子栏目代码",
                                Operate: "=",
                                Value: "",
                                ExtendType: 13,
                                ExtendValue: "",
                                Value2: "",
                                BlurType: "",
                            },
                        ],
                        ChildItems: [],
                    },
                ],
            },
        };
        if (fileData.keyword) {
            var titleChildItem = {
                Key: "input[data-tipid=gradetxt-1]",
                Title: "篇名",
                Logic: 0,
                Items: [
                    {
                        Key: "",
                        Title: fileData.keyword,
                        Logic: 1,
                        Name: "TI", // 搜索字段代码
                        Operate: fileData.keyword.includes(" ") ? "%" : "=", // =精确匹配, % 模糊匹配
                        Value: fileData.keyword,
                        ExtendType: 1,
                        ExtendValue: "中英文对照",
                        Value2: "",
                    },
                ],
                ChildItems: [],
            };
            queryJson.QNode.QGroup[0].ChildItems.push(titleChildItem);
        }
        if (fileData.author) {
            var authorChildItem = {
                Key: "input[data-tipid=gradetxt-2]",
                Title: "作者",
                Logic: 1,
                Items: [
                    {
                        Key: "",
                        Title: fileData.author,
                        Logic: 1,
                        Name: "AU",
                        Operate: "=",
                        Value: fileData.author,
                        ExtendType: 1,
                        ExtendValue: "中英文对照",
                        Value2: "",
                    },
                ],
                ChildItems: [],
            };
            queryJson.QNode.QGroup[0].ChildItems.push(authorChildItem);
        }
        var postData =
            "IsSearch=true&QueryJson=" +
            encodeURIComponent(JSON.stringify(queryJson)) +
            "&PageName=DefaultResult&DBCode=SCDB" +
            "&KuaKuCodes=CJFQ%2CCCND%2CCIPD%2CCDMD%2CCYFD%2CBDZK%2CSCOD%2CCISD%2CSNAD%2CCCJD%2CGXDB_SECTION%2CCJFN" +
            "&CurPage=1&RecordsCntPerPage=20&CurDisplayMode=listmode" +
            "&CurrSortField=&CurrSortFieldType=desc&IsSentenceSearch=false&Subject=";
        return postData;
    },

    selectRow: function (rowSelectors) {
        Zotero.debug("**Jasminum select window start");
        var io = { dataIn: rowSelectors, dataOut: null };
        var newDialog = window.openDialog(
            "chrome://zotero/content/ingester/selectitems.xul",
            "_blank",
            "chrome,modal,centerscreen,resizable=yes",
            io
        );
        return io.dataOut;
    },

    getIDFromUrl: function (url) {
        if (!url) return false;
        // add regex for navi.cnki.net
        var dbname = url.match(/[?&](?:db|table)[nN]ame=([^&#]*)/i);
        var filename = url.match(/[?&]filename=([^&#]*)/i);
        var dbcode = url.match(/[?&]dbcode=([^&#]*)/i);
        if (
            !dbname ||
            !dbname[1] ||
            !filename ||
            !filename[1] ||
            !dbcode ||
            !dbcode[1]
        )
            return false;
        return { dbname: dbname[1], filename: filename[1], dbcode: dbcode[1] };
    },

    string2HTML: function (text) {
        // Use DOMParser to parse text to HTML.
        // This DOMParser is from XPCOM.
        var parser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
            .createInstance(Components.interfaces.nsIDOMParser);
        return parser.parseFromString(text, "text/html");
    },


    search: async function (fileData) {
        Zotero.debug("**Jasminum start search");
        var postData = Zotero.Jasminum.createPostData(fileData);
        var requestHeaders = {
            Accept: "text/html, */*; q=0.01",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7",
            Connection: "keep-alive",
            "Content-Length": "2085",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Host: "kns.cnki.net",
            Origin: "https://kns.cnki.net",
            Referer:
                "https://kns.cnki.net/kns8/AdvSearch?dbprefix=SCDB&&crossDbcodes=CJFQ%2CCDMD%2CCIPD%2CCCND%2CCISD%2CSNAD%2CBDZK%2CCJFN%2CCCJD",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "X-Requested-With": "XMLHttpRequest",
        };
        var postUrl = "https://kns.cnki.net/KNS8/Brief/GetGridTableHtml";
        if (!Zotero.Jasminum.CookieSandbox) {
            Zotero.Jasminum.setCookieSandbox();
        }
        // Zotero.debug(Zotero.Jasminum.CookieSandbox);
        var resp = await Zotero.HTTP.request("POST", postUrl, {
            headers: requestHeaders,
            cookieSandbox: Zotero.Jasminum.CookieSandbox,
            body: postData,
        });
        // Zotero.debug(resp.responseText);
        var targetRows = Zotero.Jasminum.getSearchItems(resp.responseText);
        return targetRows;
    },

    getSearchItems: function (resptext) {
        Zotero.debug("**Jasminum get item from search");
        var html = Zotero.Jasminum.string2HTML(resptext);
        var rows = html.querySelectorAll(
            "table.result-table-list > tbody > tr"
        );
        Zotero.debug("**Jasminum 搜索结果：" + rows.length);
        var targetRows = [];
        if (!rows.length) {
            Zotero.debug("**Jasminum No items found.");
            return null;
        } else if (rows.length == 1) {
            targetRows.push(rows[0]);
            Zotero.debug(rows[0].textContent.split(/\s+/).join(" "));
        } else {
            // Get the right item from search result.
            var rowIndicators = {};
            for (let idx = 0; idx < rows.length; idx++) {
                var rowText = rows[idx].textContent.split(/\s+/).join(" ");
                rowIndicators[idx] = rowText;
                Zotero.debug(rowText);
            }
            var targetIndicator = Zotero.Jasminum.selectRow(rowIndicators);
            // Zotero.debug(targetIndicator);
            // No item selected, return null
            if (!targetIndicator) return null;
            Object.keys(targetIndicator).forEach(function (i) {
                targetRows.push(rows[i]);
            });
        }
        // Zotero.debug(targetRow.textContent);
        return targetRows;
    },

    // Get CNKI citations from targetRow
    getCitation: function (targetRow) {
        // Citation in web page or search table row
        var cite_page = Zotero.Utilities.xpath(targetRow, "//em[text()= '被引频次']/parent::span/text()");
        var cite_search = targetRow.getElementsByClassName("quote")[0].innerText.trim();
        return cite_page[0] ? cite_page.length > 0 : cite_search;
    },

    // Get refwork data from search target rows
    getRefworks: async function (targetRows) {
        Zotero.debug("**Jasminum start get ref");
        if (targetRows == null) {
            return new Error("No items returned from the CNKI");
        }
        var targetData = { targetUrls: [], citations: [] }, // url, citation
            targetIDs = [];
        targetRows.forEach(function (r) {
            var url = r.getElementsByClassName("fz14")[0].getAttribute("href");
            var cite = Zotero.Jasminum.getCitation(r);
            targetIDs.push(Zotero.Jasminum.getIDFromUrl(url));
            targetData.citations.push(cite);
        });
        Zotero.debug(targetIDs);
        var postData = "filename=";
        // filename=CPFDLAST2020!ZGXD202011001016!1!14%2CCPFDLAST2020!ZKBD202011001034!2!14&displaymode=Refworks&orderparam=0&ordertype=desc&selectfield=&random=0.9317799522629542
        for (let idx = 0; idx < targetIDs.length; idx++) {
            postData =
                postData +
                targetIDs[idx].dbname +
                "!" +
                targetIDs[idx].filename +
                "!" +
                (idx + 1) +
                "!8%2C";
            targetData.targetUrls.push(
                `https://kns.cnki.net/KCMS/detail/detail.aspx?dbcode=${targetIDs[idx].dbcode}&dbname=${targetIDs[idx].dbname}&filename=${targetIDs[idx].filename}&v=`
            );
        }
        postData = postData.replace(/%2C$/g, "");
        postData =
            postData +
            "&displaymode=Refworks&orderparam=0&ordertype=desc&selectfield=&random=0.9317799522629542";
        Zotero.debug(postData);
        var url = "https://kns.cnki.net/KNS8/manage/ShowExport";
        if (!Zotero.Jasminum.RefCookieSandbox) {
            Zotero.Jasminum.setRefCookieSandbox();
        }
        var resp = await Zotero.HTTP.request("POST", url, {
            cookieSandbox: Zotero.Jasminum.RefCookieSandbox,
            body: postData,
        });
        Zotero.debug(resp.responseText);
        var data = resp.responseText
            .replace("<ul class='literature-list'><li>", "")
            .replace("<br></li></ul>", "")
            .replace("</li><li>", "") // divide results
            .replace(/<br>|\r/g, "\n")
            .replace(/vo (\d+)\n/, "VO $1\n") // Divide VO and IS to different line
            .replace(/\n+/g, "\n")
            .replace(/\n([A-Z][A-Z1-9]\s)/g, "<br>$1")
            .replace(/\n/g, "")
            .replace(/<br>/g, "\n")
            .replace(/\t/g, "") // \t in abstract
            .replace(
                /^RT\s+Conference Proceeding/gim,
                "RT Conference Proceedings"
            )
            .replace(/^RT\s+Dissertation\/Thesis/gim, "RT Dissertation")
            .replace(/^(A[1-4]|U2)\s*([^\r\n]+)/gm, function (m, tag, authors) {
                authors = authors.split(/\s*[;，,]\s*/); // that's a special comma
                if (!authors[authors.length - 1].trim()) authors.pop();
                return tag + " " + authors.join("\n" + tag + " ");
            })
            .trim();
        Zotero.debug(data.split("\n"));
        return [data, targetData];
    },

    promiseTranslate: async function (translate, libraryID) {
        Zotero.debug("** Jasminum translate begin ...");
        translate.setHandler("select", function (translate, items, callback) {
            for (let i in items) {
                let obj = {};
                obj[i] = items[i];
                callback(obj);
                return;
            }
        });

        let newItems = await translate.translate({
            libraryID: libraryID,
            saveAttachments: false,
        });
        if (newItems.length) {
            Zotero.debug(newItems);
            Zotero.debug("** Jasminum translate end.");
            return newItems;
        }
        throw new Error("No items found");
    },

    fixItem: async function (newItems, targetData) {
        var creators;
        // 学位论文Thesis，导师 -> contributor
        for (let idx = 0; idx < newItems.length; idx++) {
            var newItem = newItems[idx];
            if (newItem.getNotes()) {
                if (Zotero.ItemTypes.getName(newItem.itemTypeID) == "thesis") {
                    creators = newItem.getCreators();
                    var note = Zotero.Items.get(newItem.getNotes()[0])
                        .getNote()
                        .split(/<br\s?\/>/);
                    // Zotero.debug(note);
                    for (let line of note) {
                        if (line.startsWith("A3")) {
                            var creator = {
                                firstName: "",
                                lastName: line.replace("A3 ", ""),
                                creatorType: "contributor",
                                fieldMode: true,
                            };
                            creators.push(creator);
                        }
                    }
                    newItem.setCreators(creators);
                }
                Zotero.Items.erase(newItem.getNotes());
            }
            // 是否处理中文姓名. For Chinese name
            if (Zotero.Prefs.get("jasminum.zhnamesplit")) {
                creators = newItem.getCreators();
                for (var i = 0; i < creators.length; i++) {
                    var creator = creators[i];
                    if (creator.firstName) continue;

                    var lastSpace = creator.lastName.lastIndexOf(" ");
                    if (
                        creator.lastName.search(/[A-Za-z]/) !== -1 &&
                        lastSpace !== -1
                    ) {
                        // western name. split on last space
                        creator.firstName = creator.lastName.substr(
                            0,
                            lastSpace
                        );
                        creator.lastName = creator.lastName.substr(
                            lastSpace + 1
                        );
                    } else {
                        // Chinese name. first character is last name, the rest are first name
                        creator.firstName = creator.lastName.substr(1);
                        creator.lastName = creator.lastName.charAt(0);
                    }
                    creators[i] = creator;
                }
                newItem.setCreators(creators);
            }
            // Clean up abstract
            if (newItem.getField("abstractNote")) {
                newItem.setField(
                    "abstractNote",
                    newItem
                        .getField("abstractNote")
                        .replace(/\s*[\r\n]\s*/g, "\n")
                        .replace(/&lt;.*?&gt;/g, "")
                );
            }
            // Parse page content.
            var extraString = '';
            Zotero.debug("** Jasminum get article page.");
            var resp = await Zotero.HTTP.request("GET", targetData.targetUrls[idx]);
            var html = Zotero.Jasminum.string2HTML(resp.responseText);
            // Full abstract note.
            if (newItem.getField("abstractNote").endsWith("...")) {
                var abs = html.querySelector("#ChDivSummary");
                Zotero.debug("** Jasminum abs " + abs.innerText);
                if (abs.innerText) {
                    newItem.setField("abstractNote", abs.innerText.trim());
                }
            }
            // Add DOI
            var doi = Zotero.Utilities.xpath(html, "//*[contains(text(), 'DOI')]/following-sibling::p");
            if ('DOI' in newItem && doi.length > 0) {  // Some items lack DOI field
                newItem.setField("DOI", doi[0].innerText);
            }

            // Remove wront CN field.
            newItem.setField("callNumber", "");
            if (Zotero.ItemTypes.getName(newItem.itemTypeID) != "patent") {
                newItem.setField("libraryCatalog", "CNKI");
            }
            newItem.setField("url", targetData.targetUrls[idx]);
            if (targetData.citations[idx]) {  // Add citation
                var m = new Date();
                var dateString = m.getUTCFullYear() + "-" +
                    ("0" + (m.getUTCMonth() + 1)).slice(-2) + "-" +
                    ("0" + m.getUTCDate()).slice(-2);
                var citationString = `${targetData.citations[idx]} citations(CNKI)[${dateString}]`;
                extraString = citationString;
            }

            // Add Article publisher type, surrounded by <>. 核心期刊
            var publisherType = Zotero.Utilities.xpath(html, "//div[@class='top-tip']//a[@class='type']");
            if (publisherType.length > 0) {
                extraString = extraString + "<" + publisherType.map(function (ele) {
                    return ele.innerText
                }
                ).join(", ")
                    + ">";
            }

            newItem.setField("extra", extraString);

            // Keep tags according global config.
            if (Zotero.Prefs.get("automaticTags") === false) {
                newItem.setTags([]);
            }
            // Change tag type
            var tags = newItem.getTags();
            // Zotero.debug('** Jasminum tags length: ' + tags.length);
            if (tags.length > 0) {
                var newTags = [];
                for (let tag of tags) {
                    tag.type = 1;
                    newTags.push(tag);
                }
                newItem.setTags(newTags);
            }
            newItems[idx] = newItem;
        }
        return newItems;
    },

    updateItems: async function (items) {
        if (items.length == 0) return;
        var item = items.shift();
        var itemCollections = item.getCollections();
        var libraryID = item.libraryID;
        if (!Zotero.Jasminum.checkItem(item)) return; // TODO Need notify
        var fileData = Zotero.Jasminum.splitFilename(item.getFilename());
        Zotero.debug(fileData);
        var targetRows = await Zotero.Jasminum.search(fileData);
        // 有查询结果返回
        if (targetRows && targetRows.length > 0) {
            var [data, targetData] = await Zotero.Jasminum.getRefworks(
                targetRows
            );
            var translate = new Zotero.Translate.Import();
            translate.setTranslator("1a3506da-a303-4b0a-a1cd-f216e6138d86");
            translate.setString(data);
            var newItems = await Zotero.Jasminum.promiseTranslate(
                translate,
                libraryID
            );
            Zotero.debug(newItems);
            newItems = await Zotero.Jasminum.fixItem(newItems, targetData);
            Zotero.debug("** Jasminum DB trans ...");
            if (itemCollections.length) {
                for (let collectionID of itemCollections) {
                    newItems.forEach(function (item) {
                        item.addToCollection(collectionID);
                    });
                }
            }
            // 只有单个返回结果
            if (newItems.length == 1) {
                var newItem = newItems[0];
                // Put old item as a child of the new item
                item.parentID = newItem.id;
                // Use Zotfile to rename file
                if (
                    Zotero.Prefs.get("jasminum.rename") &&
                    typeof Zotero.ZotFile != "undefined"
                ) {
                    Zotero.ZotFile.renameSelectedAttachments();
                }

                await item.saveTx();
                await newItem.saveTx();
                // Add bookmark after attaching to  new item
                if (
                    Zotero.Prefs.get("jasminum.autobookmark") &&
                    Zotero.Jasminum.checkItemPDF(item)
                ) {
                    await Zotero.Jasminum.addBookmarkItem(item);
                }
            } else {
                // 有多个返回结果，将文件与新条目关联，用于用户后续手动选择
                newItems.forEach(function (newItem) {
                    item.addRelatedItem(newItem);
                });
                await item.saveTx();
            }
            if (items.length) {
                Zotero.Jasminum.updateItems(items);
            }
            Zotero.debug("** Jasminum finished.");
        } else {
            // 没有查询结果
            alert(
                `No result found!\n作者：${fileData.author}\n篇名：${fileData.keyword}\n请检查设置中的文件名模板是否与实际实际情况相符`
            );
        }
    },

    checkItemPDF: function (item) {
        return (
            !item.isTopLevelItem() &&
            item.isAttachment() &&
            item.attachmentContentType &&
            item.attachmentContentType === "application/pdf" &&
            item.parentItem.getField("libraryCatalog") &&
            item.parentItem.getField("libraryCatalog").includes("CNKI") &&
            Zotero.ItemTypes.getName(item.parentItem.itemTypeID) === "thesis"
        );
    },

    getReaderUrl: function (itemUrl) {
        Zotero.debug("** Jasminum get Reader url.");
        var itemid = Zotero.Jasminum.getIDFromUrl(itemUrl);
        var readerUrl =
            "https://kreader.cnki.net/Kreader/CatalogViewPage.aspx?dbCode=" +
            itemid.dbcode +
            "&filename=" +
            itemid.filename +
            "&tablename=" +
            itemid.dbname +
            "&compose=&first=1&uid=";
        return readerUrl;
    },

    getChapterUrl: async function (readerUrl) {
        var reader = await Zotero.HTTP.request("GET", readerUrl);
        var readerHTML = Zotero.Jasminum.string2HTML(reader.responseText);
        return (
            "https://kreader.cnki.net/Kreader/" +
            readerHTML.querySelector("iframe").getAttribute("src")
        );
    },

    getChapterText: async function (chapterUrl, item) {
        var key = item.key;
        var lib = item.libraryID;
        var chapter = await Zotero.HTTP.request("GET", chapterUrl);
        var chapterHTML = Zotero.Jasminum.string2HTML(
            chapter.responseText
        );
        var tree = chapterHTML.getElementById("treeDiv");
        var rows = tree.querySelectorAll("tr");
        var rows_array = [];
        var note = "";
        for (let row of rows) {
            Zotero.debug(row.textContent.trim());
            var cols = row.querySelectorAll("td");
            var level = cols.length - 1;
            var title = row.textContent.trim();
            var onclickText = cols[cols.length - 1]
                .querySelector("a")
                .getAttribute("onclick");
            var pageRex = onclickText.match(/CDMDNodeClick\('(\d+)'/);
            var page = pageRex[1];
            var bookmark = `BookmarkBegin\nBookmarkTitle: ${title}\nBookmarkLevel: ${level}\nBookmarkPageNumber: ${page}`;
            rows_array.push(bookmark);
            note += `<li style="padding-top: ${level == 1 ? 4 : 8
                }px; padding-left: ${12 * (level - 1)
                }px"><a href="zotero://open-pdf/${lib}_${key}/${page}">${title}</a></li>\n`;
        }
        note =
            '<p id="title"><strong>Contents</strong></p>\n' +
            '<ul id="toc" style="list-style-type: none; padding-left: 0px">\n' +
            note +
            "</ul>";
        return [rows_array.join("\n"), note];
    },
    // Find chapter page number from CNKI reader side bar.
    getBookmark: async function (item) {
        // demo url     https://kreader.cnki.net/Kreader/buildTree.aspx?dbCode=cdmd&FileName=1020622678.nh&TableName=CMFDTEMP&sourceCode=GHSFU&date=&year=2020&period=&fileNameList=&compose=&subscribe=&titleName=&columnCode=&previousType=_&uid=
        var parentItem = item.parentItem;
        var itemUrl = "";
        var itemReaderUrl = "";
        var itemChapterUrl = "";
        if (
            // 匹配知网 URL
            parentItem.getField("url") &&
            parentItem.getField("url").match(/^https?:\/\/kns\.cnki\.net/) &&// Except nxgp.cnki.net
            Zotero.Jasminum.getIDFromUrl(parentItem.getField("url")) // A valid ID
        ) {
            Zotero.debug("** Jasminum item url exists");
            itemUrl = parentItem.getField("url");
        } else {
            Zotero.debug("Jasminum search for item url");
            var fileData = {
                keyword: parentItem.getField("title"),
                author:
                    parentItem.getCreator(0).lastName +
                    parentItem.getCreator(0).firstName,
            };
            var targetRows = await Zotero.Jasminum.search(fileData);
            if (targetRows.length === 0) {
                return null;
            }
            // Frist row in search table is selected.
            itemUrl = targetRows[0].querySelector("a.fz14").getAttribute("href");
            itemUrl = "https://kns.cnki.net/KCMS" + itemUrl.slice(4);
            // 获取文献链接URL -> 获取章节目录URL
        }
        Zotero.debug("** Jasminum item url: " + itemUrl);
        itemReaderUrl = Zotero.Jasminum.getReaderUrl(itemUrl);
        Zotero.debug("** Jasminum item reader url: " + itemReaderUrl);
        itemChapterUrl = await Zotero.Jasminum.getChapterUrl(itemReaderUrl);
        Zotero.debug("** Jasminum item chapter url: " + itemChapterUrl);
        // Next line raises: Invalid chrome URI: /
        var out = Zotero.Jasminum.getChapterText(itemChapterUrl, item);
        return out;
    },

    addBookmark: async function (item, bookmark) {
        Zotero.debug("** Jasminum add bookmark begin");
        // Zotero.debug(item);
        let cacheFile = Zotero.getTempDirectory();
        let cachePDF = Zotero.getTempDirectory();
        // PDFtk will throw errors when args contains Chinese character
        // So create a tmp folder.
        if (Zotero.isWin) {
            var newTmp = OS.Path.join(cacheFile.path.slice(0, 3), "tmp");
            Zotero.debug("** Jasminum new tmp path " + newTmp);
            cacheFile = Zotero.getTempDirectory();
            cachePDF = Zotero.getTempDirectory();
            cacheFile.initWithPath(newTmp);
            cachePDF.initWithPath(newTmp);
            if (!cacheFile.exists()) {
                cacheFile.create(
                    Components.interfaces.nsIFile.DIRECTORY_TYPE,
                    0777
                );
            }
        }
        cacheFile.append("bookmark.txt");
        if (cacheFile.exists()) {
            cacheFile.remove(false);
        }

        cachePDF.append("output.pdf");
        if (cachePDF.exists()) {
            cachePDF.remove(false);
        }

        let encoder = new TextEncoder();
        let array = encoder.encode(bookmark);
        await OS.File.writeAtomic(cacheFile.path, array, {
            tmpPath: cacheFile.path + ".tmp",
        });
        var pdftk = Zotero.Prefs.get("jasminum.pdftkpath");
        if (Zotero.isWin) {
            pdftk = OS.Path.join(pdftk, "pdftk.exe");
        } else {
            pdftk = OS.Path.join(pdftk, "pdftk");
        }
        Zotero.debug("** Jasminum pdftk path: " + pdftk);
        var args = [
            item.getFilePath(),
            "update_info_utf8",
            cacheFile.path,
            "output",
            cachePDF.path,
        ];
        Zotero.debug(
            "PDFtk: Running " +
            pdftk +
            " " +
            args.map((arg) => "'" + arg + "'").join(" ")
        );
        try {
            await Zotero.Utilities.Internal.exec(pdftk, args);
            await OS.File.copy(cachePDF.path, item.getFilePath());
            cacheFile.remove(false);
            cachePDF.remove(false);
            Zotero.debug("** Jasminum add bookmark complete!");
        } catch (e) {
            Zotero.logError(e);
            try {
                cacheFile.remove(false);
                cachePDF.remove(false);
            } catch (e) {
                Zotero.logError(e);
            }
            throw new Zotero.Exception.Alert("PDFtk add bookmark failed.");
        }
    },

    addBookmarkItem: async function (item) {
        if (!(await Zotero.Jasminum.checkPath())) {
            alert(
                "Can't find PDFtk Server execute file. Please install PDFtk Server and choose the folder in the Jasminum preference window."
            );
            return false;
        }
        // Show alert when file is missing
        var attachmentExists = await OS.File.exists(item.getFilePath());
        if (!attachmentExists) {
            alert("Item Attachment file is missing.");
            return false;
        }
        var bookmark, note;
        [bookmark, note] = await Zotero.Jasminum.getBookmark(item);
        if (!bookmark) {
            alert("No Bookmark found!\n书签信息未找到");
        } else {
            // Add TOC note
            var noteHTML = item.getNote();
            noteHTML += note;
            item.setNote(noteHTML);
            await item.saveTx();
            await Zotero.Jasminum.addBookmark(item, bookmark);
        }
    },

    // Function to be called in Menu
    addBookmarkItemM: async function () {
        var item = ZoteroPane.getSelectedItems()[0];
        await Zotero.Jasminum.addBookmarkItem(item);
    },

    checkPath: async function () {
        Zotero.debug("** Jasminum check path.");
        var pdftkpath = Zotero.Prefs.get("jasminum.pdftkpath");
        Zotero.debug(pdftkpath);
        var pdftk = "";
        if (Zotero.isWin) {
            pdftk = OS.Path.join(pdftkpath, "pdftk.exe");
        } else {
            pdftk = OS.Path.join(pdftkpath, "pdftk");
        }
        Zotero.debug(pdftk);
        var fileExist = await OS.File.exists(pdftk);
        Zotero.debug(fileExist);
        return fileExist;
    },

    checkItemName: function (item) {
        return item.isRegularItem() && item.isTopLevelItem();
    },

    splitNameM: function () {
        var items = ZoteroPane.getSelectedItems();
        Zotero.Jasminum.splitName(items);
    },

    mergeNameM: function () {
        var items = ZoteroPane.getSelectedItems();
        Zotero.Jasminum.mergeName(items);
    },

    splitName: async function (items) {
        for (let item of items) {
            var creators = item.getCreators();
            for (var i = 0; i < creators.length; i++) {
                var creator = creators[i];
                if (
                    // English Name pass
                    creator.lastName.search(/[A-Za-z]/) !== -1 ||
                    creator.firstName.search(/[A-Za-z]/) !== -1 ||
                    creator.firstName // 如果有名就不拆分了
                ) {
                    var EnglishName = creator.lastName;
                    var temp = EnglishName.split(/[\n\s+,]/g);
                    for (var k = 0; k < temp.length; k++) {
                        if (temp[k] == "") {
                            // 删除数组中空值
                            temp.splice(k, 1);
                            k--;
                        }
                    }
                    if (temp.length < 3) {
                        creator.lastName = temp[0];
                        creator.firstName = temp[1];
                    } else {
                        creator.lastName = temp[0];
                        creator.firstName = temp[1].concat(" ", temp[2]);
                    }
                    creator.fieldMode = 0;// 0: two-field, 1: one-field (with empty first name)
                    creators[i] = creator;
                } else {  // For Chinese Name
                    var chineseName = creator.lastName
                        ? creator.lastName
                        : creator.firstName;
                    creator.lastName = chineseName.charAt(0);
                    creator.firstName = chineseName.substr(1);
                    creator.fieldMode = 0;
                    creators[i] = creator;
                }
            }
            if (creators != item.getCreators()) {
                item.setCreators(creators);
                item.saveTx();
            }
        }
    },

    mergeName: async function (items) {
        for (let item of items) {
            var creators = item.getCreators();
            for (var i = 0; i < creators.length; i++) {
                var creator = creators[i];
                if (
                    // English Name pass
                    creator.lastName.search(/[A-Za-z]/) !== -1 ||
                    creator.lastName.search(/[A-Za-z]/) !== -1
                ) {
                    creator.lastName = creator.lastName + " " + creator.firstName;
                    creator.firstName = "";
                    creator.fieldMode = 1;// 0: two-field, 1: one-field (with empty first name)
                    creators[i] = creator;
                } else { // For Chinese Name
                    creator.lastName = creator.lastName + creator.firstName;
                    creator.firstName = "";
                    creator.fieldMode = 1;
                    creators[i] = creator;
                }
            }
            if (creators != item.getCreators()) {
                item.setCreators(creators);
                item.saveTx();
            }
        }
    },

    removeDotM: function () {
        var items = ZoteroPane.getSelectedItems();
        Zotero.Jasminum.removeDot(items);
    },

    removeDot: async function (items) {
        for (let item of items) {
            var attachmentIDs = item.getAttachments();
            for (let id of attachmentIDs) {
                var atta = Zotero.Items.get(id);
                var newName = atta.attachmentFilename.replace(
                    /([_\u4e00-\u9fa5]), ([_\u4e00-\u9fa5])/g,
                    "$1$2"
                );
                await atta.renameAttachmentFile(newName);
                atta.setField("title", newName);
                atta.saveTx();
            }
        }
    },
};

window.addEventListener(
    "load",
    function (e) {
        Zotero.Jasminum.init();
        if (window.ZoteroPane) {
            var doc = window.ZoteroPane.document;
            // add event listener for zotfile menu items
            doc.getElementById("zotero-itemmenu").addEventListener(
                "popupshowing",
                Zotero.Jasminum.displayMenuitem,
                false
            );
        }
    },
    false
);
