/**
 * @fileOverview jquery-autocomplete, the jQuery Autocompleter
 * @author <a href="mailto:dylan@dyve.net">Dylan Verheul</a>
 * @version 2.4.4
 * @requires jQuery 1.6+
 * @license MIT | GPL | Apache 2.0, see LICENSE.txt
 * @see https://github.com/dyve/jquery-autocomplete
 */

/*
ISSUES:
- Start typeing, esc, select all, then esc again (not auto completing)
- Press arrow, scroll to load more data, select something from new list, click outside (requires 2 clicks)
*/
(function($) {
    "use strict";
     
    /**
     * jQuery autocomplete plugin
     * @param {object|string} options
     * @returns (object} jQuery object
     */
    $.fn.autocomplete = function(options) {
        /*
        REMOVED: URL is no longer passed as options, its now constructed using a function
        var url;
        if (arguments.length > 1) {
            url = options;
            options = arguments[1];
            options.url = url;
        } else if (typeof options === 'string') {
            url = options;
            options = { url: url };
        }*/
        // Do a deep copy so that new extraParams object is created
        var opts = $.extend(true, {}, $.fn.autocomplete.defaults, options);
        return this.each(function() {
            var $this = $(this);
            $this.data('autocompleter', new $.Autocompleter(
                $this,
                $.meta ? $.extend({}, opts, $this.data()) : opts
            ));
        });
    };

    /**
     * Store default options
     * @type {object}
     */
    $.fn.autocomplete.defaults = {
        inputClass: 'acInput',
        inputAcClass: 'acInput-back',
        inputWrapper: 'acWrapper',
        loadingClass: 'acLoading',
        resultsClass: 'acResults',
        selectClass: 'acSelect',
        noMatchMessage: 'No items found',
        remoteDataType: false,
        lineSeparator: '\n',
        cellSeparator: '|',
        minChars: 2,
        maxItemsToShow: 10, // This now defines how many items to be shown in the dropdown
        delay: 400,
        useCache: true,
        maxCacheLength: 10,
        matchSubset: true,
        matchCase: false,
        matchInside: true,
        mustMatch: false,
        selectFirst: false,
        selectOnly: false,
        showResult: null,
        preventDefaultReturn: 1,
        preventDefaultTab: 0,
        autoFill: false,
        filterResults: true,
        filter: true,
        sortResults: true,
        sortFunction: null,
        onItemSelect: null,
        onNoMatch: null,
        onFinish: null,
        matchStringConverter: null,
        beforeUseConverter: null,
        autoWidth: 'min-width',
        useDelimiter: false,
        delimiterChar: ',',
        delimiterKeyCode: 188,
        processData: null,
        onError: null,
        numLoadInitial: 10,
        numLoadSubsequent: 100,
        onBuildUrl: function(query, skip, limit) {}
    };

    /**
     * 
     */
    var deepObjectCompare = function (x, y) {
        if (x === y) return true;
        // if both x and y are null or undefined and exactly the same

        if (!(x instanceof Object) || !(y instanceof Object)) return false;
        // if they are not strictly equal, they both need to be Objects

        if (x.constructor !== y.constructor) return false;
        // they must have the exact same prototype chain, the closest we can do is
        // test there constructor.

        for (var p in x) {
            if (!x.hasOwnProperty(p)) continue;
            // other properties were tested using x.constructor === y.constructor

            if (!y.hasOwnProperty(p)) return false;
            // allows to compare x[ p ] and y[ p ] when set to undefined

            if (x[p] === y[p]) continue;
            // if they have the same strict value or identity then they are equal

            if (typeof (x[p]) !== "object") return false;
            // Numbers, Strings, Functions, Booleans must be strictly equal

            if (!Object.equals(x[p], y[p])) return false;
            // Objects and Arrays must be tested recursively
        }

        for (p in y) {
            if (y.hasOwnProperty(p) && !x.hasOwnProperty(p)) return false;
            // allows x[ p ] to be set to undefined
        }
        return true;
    }

    /**
     * Sanitize result
     * @param {Object} result
     * @returns {Object} object with members value (String) and data (Object)
     * @private
     */
    var sanitizeResult = function(result) {
        var value, data;
        var type = typeof result;
        if (type === 'string') {
            value = result;
            data = {};
        } else if ($.isArray(result)) {
            value = result[0];
            data = result.slice(1);
        } else if (type === 'object') {
            value = result.value;
            data = result.data;
        }
        
        value = String(value);
        if (typeof data !== 'object') {
            data = {};
        }
        return {
            value: value,
            data: data
        };
    };

    /**
     * Sanitize integer
     * @param {mixed} value
     * @param {Object} options
     * @returns {Number} integer
     * @private
     */
    var sanitizeInteger = function(value, stdValue, options) {
        var num = parseInt(value, 10);
        options = options || {};
        if (isNaN(num) || (options.min && num < options.min)) {
            num = stdValue;
        }
        return num;
    };

    /**
     * Create partial url for a name/value pair
     */
    var makeUrlParam = function(name, value) {
        return [name, encodeURIComponent(value)].join('=');
    };

    /**
     * Build an url
     * @param {string} url Base url
     * @param {object} [params] Dictionary of parameters
     */
    var makeUrl = function(url, params) {
        var urlAppend = [];
        $.each(params, function(index, value) {
            urlAppend.push(makeUrlParam(index, value));
        });
        if (urlAppend.length) {
            url += url.indexOf('?') === -1 ? '?' : '&';
            url += urlAppend.join('&');
        }
        return url;
    };

    /**
     * Default sort filter
     * @param {object} a
     * @param {object} b
     * @param {boolean} matchCase
     * @returns {number}
     */
    var sortValueAlpha = function(a, b, matchCase) {
        a = String(a.value);
        b = String(b.value);
        if (!matchCase) {
            a = a.toLowerCase();
            b = b.toLowerCase();
        }
        if (a > b) {
            return 1;
        }
        if (a < b) {
            return -1;
        }
        return 0;
    };

    /**
     * Parse data received in text format
     * @param {string} text Plain text input
     * @param {string} lineSeparator String that separates lines
     * @param {string} cellSeparator String that separates cells
     * @returns {array} Array of autocomplete data objects
     */
    var plainTextParser = function(text, lineSeparator, cellSeparator) {
        var results = [];
        var i, j, data, line, value, lines, returnedText;
        returnedText = String(text).replace('\r\n', '\n');
        if (returnedText.length > 0) {
            // Be nice, fix linebreaks before splitting on lineSeparator
            lines = returnedText.split(lineSeparator);
            for (i = 0; i < lines.length; i++) {
                line = lines[i].split(cellSeparator);
                data = [];
                for (j = 0; j < line.length; j++) {
                    data.push(decodeURIComponent(line[j]));
                }
                value = data.shift();
                results.push({ value: value, data: data });
            }
        }
        return results;
    };

    /**
     * Autocompleter class
     * @param {object} $elem jQuery object with one input tag
     * @param {object} options Settings
     * @constructor
     */
    $.Autocompleter = function($elem, options) {

        /**
         * Assert parameters
         */
        if (!$elem || !($elem instanceof $) || $elem.length !== 1 || $elem.get(0).tagName.toUpperCase() !== 'INPUT') {
            throw new Error('Invalid parameter for jquery.Autocompleter, jQuery object with one element with INPUT tag expected.');
        }

        /**
         * @constant Link to this instance
         * @type object
         * @private
         */
        var self = this;

        /**
         * @property {object} Options for this instance
         * @public
         */
        this.options = options;

        /**
         * @property object Cached data for this instance
         * @private
         */
        this.cacheData_ = {};

        /**
         * @property {number} Number of cached data items
         * @private
         */
        this.cacheLength_ = 0;

        /**
         * @property {string} Class name to mark selected item
         * @private
         */
        this.selectClass_ = 'jquery-autocomplete-selected-item';

        /**
         * @property {number} Handler to activation timeout
         * @private
         */
        this.keyTimeout_ = null;

        /**
         * @property {number} Handler to finish timeout
         * @private
         */
        this.blurTimeout_ = null;
        this.focusTimeout_ = null;

        /**
         * @property {number} Last key pressed in the input field (store for behavior)
         * @private
         */
        this.lastKeyPressed_ = null;

        /**
         * @property {string} Last value processed by the autocompleter
         * @private
         */
        this.lastProcessedValue_ = null;
        
        /**
         * @property {string} Last value selected by the user
         * @private
         */
        this.lastSelectedValue_ = null; 

        /**
         * @property {boolean} Is this autocompleter active (showing results)?
         * @see showResults
         * @private
         */
        this.showingResults_ = false;

        /**
         * @property {boolean} Is this autocompleter allowed to finish on blur?
         * @private
         */
        this.finishOnBlur_ = true;
        
        /**
         * @property {object} current $.ajax request
         * @private
         */
        this.fetchRemoteRequest_ = null;
        this.fetchRemoteRequestUrl_ = null;
        

        /**
         * @property {int} number of records fetched so far
         * @private
         */
        this.numFetched_ = null;        
        this.isMouseOverControlElement_ = null;
        
        // This is set to true when we are scrolling so that we ignore hover events (if mouse is over the list)
        this.isScrolling = false;
        this.scrollingTimer = null;

        /**
         * Sanitize options
         */
        this.options.minChars = sanitizeInteger(this.options.minChars, $.fn.autocomplete.defaults.minChars, { min: 0 });
        this.options.maxItemsToShow = sanitizeInteger(this.options.maxItemsToShow, $.fn.autocomplete.defaults.maxItemsToShow, { min: 0 });
        this.options.maxCacheLength = sanitizeInteger(this.options.maxCacheLength, $.fn.autocomplete.defaults.maxCacheLength, { min: 1 });
        this.options.delay = sanitizeInteger(this.options.delay, $.fn.autocomplete.defaults.delay, { min: 0 });
        if (this.options.preventDefaultReturn !== 2) {
            this.options.preventDefaultReturn = this.options.preventDefaultReturn ? 1 : 0;
        }
        if (this.options.preventDefaultTab !== 2) {
            this.options.preventDefaultTab = this.options.preventDefaultTab ? 1 : 0;
        }

        /**
         * Init DOM elements repository
         */
        this.dom = {};

        /**
         * Store the input element we're attached to in the repository
         */
        this.dom.$elem = $elem;

        /**
         * Switch off the native autocomplete and add the input class
         */
        this.dom.$elem.attr('autocomplete', 'off').attr('autocorrect', 'off').attr('autocapitalize', 'none').attr('spellcheck', 'false').addClass(this.options.inputClass);
        
        // Clone input element
        this.dom.$acelem = this.dom.$elem.clone().attr({ 'id': '', 'disabled': 'disabled' }).addClass(this.options.inputAcClass);

        /**
         * Replace input field with DIV and autocomplete backing field
         */
        // Wrap div around input
        this.dom.$elem.wrap($('<div><div class="inputWrap"></div></div>').addClass(this.options.inputWrapper));
        // Get wrapper
        this.dom.$box = this.dom.$elem.parent().parent();

        // Append Arrow
        this.dom.$arrow = $('<div class="arrow"></div>');
        this.dom.$box.append(this.dom.$arrow);
        
        // Append autocomplete input
        this.dom.$elem.parent().append(this.dom.$acelem);
        
        // Append div for disabled text
        this.dom.$text = $('<div></div>', { "class": "disabledText" }).hide();
        this.dom.$elem.parent().append(this.dom.$text);
        
        
      


        /**
         * Create DOM element to hold results, and force absolute position
         */
        this.dom.$results = $('<div></div>').hide().addClass(this.options.resultsClass).css({
            position: 'absolute'
        });
        $elem.parent().parent().parent().append(this.dom.$results);

        this.dom.$list = $('<ul></ul>');
        this.dom.$results.append(this.dom.$list);

        /**
         * Attach keyboard monitoring to $elem
         */
        $elem.keydown(function (e) {
            self.lastKeyPressed_ = e.keyCode;
            switch (self.lastKeyPressed_) {

                case self.options.delimiterKeyCode: // comma = 188
                    if (self.options.useDelimiter && self.showingResults_) {
                        self.selectCurrent();
                    }
                    break;

                    // ignore navigational & special keys
                case 35: // end
                case 36: // home
                case 16: // shift
                case 17: // ctrl
                case 18: // alt
                case 37: // left
                case 39: // right
                    break;
                case 33: // page-up
                    e.preventDefault();
                    if (self.showingResults_) {
                        self.focusPageUp();
                    } else {
                        self.activate();
                    }
                    return false;

                case 34: // page-down
                    e.preventDefault();
                    if (self.showingResults_) {
                        self.focusPageDown();
                    } else {
                        self.activate();
                    }
                    return false;

                case 38: // up
                    e.preventDefault();
                    if (self.showingResults_) {
                        self.focusPrev();
                    } else {
                        self.activate();
                    }
                    return false;

                case 40: // down
                    e.preventDefault();
                    if (self.showingResults_) {
                        self.focusNext();
                    } else {
                        self.activate();
                    }
                    return false;

                case 9: // tab
                    if (self.showingResults_) {
                        self.selectCurrent();
                        if (self.options.preventDefaultTab) {
                            e.preventDefault();
                            return false;
                        }
                    }
                    if (self.options.preventDefaultTab === 2) {
                        e.preventDefault();
                        return false;
                    }
                    break;

                case 13: // return
                    if (self.showingResults_) {
                        self.selectCurrent();
                        if (self.options.preventDefaultReturn) {
                            e.preventDefault();
                            return false;
                        }
                    }
                    if (self.options.preventDefaultReturn === 2) {
                        e.preventDefault();
                        return false;
                    }
                    break;

                case 27: // escape
                    if (self.showingResults_) {
                        e.preventDefault();
                        self.deactivate();
                        return false;
                    }
                    break;

                default:
                    self.activate();

            }
            return true;
        });

        $elem.on('change', function () {
            self.activate();
        });

        /**
         * Attach paste event listener because paste may occur much later then keydown or even without a keydown at all
         */
        $elem.on('paste', function() {
            self.activate();
        });

        var onFocusFunction = function (event) {
            //console.log("onFocusRaw");
            if (self.focusTimeout_) {
                clearTimeout(self.focusTimeout_);
            }
            
            self.focusTimeout_ = setTimeout(function () {
                //console.log("onFocus");
                if (!self.showingResults_) {
                    self.activate();
                }
            }, 200);                       
        };

        var onBlurFunction = function (event) {
            //console.log("onBlurRaw");
            var localIsMouseOverControlElement = self.isMouseOverControlElement_;
            if (self.blurTimeout_) {
                clearTimeout(self.blurTimeout_);
            }
            self.blurTimeout_ = setTimeout(function() {
                //console.log("onBlur", self.isMouseOverControlElement_, localIsMouseOverControlElement, self.showingResults_);
                
                if (self.showingResults_) {

                    if (!self.isMouseOverControlElement_ && !localIsMouseOverControlElement) {
                        //console.log("onBlur - call deactivate");
                        self.deactivate();
                    } else {
                        setTimeout(function () {
                            //console.log("onBlur - call focus");
                            self.dom.$elem.focus();
                        }, 0);
                    }

                } 
                
            }, 200);
        };
        
        var onScrollFunction = function () {
            var $this = $(this),
                viewHeight = $this[0].scrollHeight,
                viewHeightCoeff = 0.6 - 10 / (viewHeight / 15 + 15);
            /*
            $this[0].scrollHeight = total height of the items
            $this[0].scrollHeight > $this.innerHeight() ==== scroll bar shown


            */
            if (viewHeight > $this.innerHeight() && $this.scrollTop() + $this.innerHeight() >= viewHeight * viewHeightCoeff) {
                if (self.fetchMoreTimeout_) {
                    clearTimeout(self.fetchMoreTimeout_);
                }
                self.fetchMoreTimeout_ = setTimeout(function () {
                    if (self.numFetched_ !== -1) {
                        self.fetchData(self.lastProcessedValue_, true);
                    }
                }, 100);                
            }
        };

        var scrollFreezeFunction = function(ev) {
            var $this = $(this),
                scrollTop = this.scrollTop,
                scrollHeight = this.scrollHeight,
                height = $this.height(),
                delta = (ev.type == 'DOMMouseScroll' ?
                    ev.originalEvent.detail * -40 :
                    ev.originalEvent.wheelDelta),
                up = delta > 0;

            var prevent = function() {
                ev.stopPropagation();
                ev.preventDefault();
                ev.returnValue = false;
                return false;
            }

            if (!up && -delta > scrollHeight - height - scrollTop) {
                // Scrolling down, but this will take us past the bottom.
                $this.scrollTop(scrollHeight);
                return prevent();
            } else if (up && delta > scrollTop) {
                // Scrolling up, but this will take us past the top.
                $this.scrollTop(0);
                return prevent();
            }
        };

              
        // BLUR event on input element
        $elem.on('blur', onBlurFunction);
        $elem.on('focus', onFocusFunction);

        // SCROLL event on LIST
        this.dom.$list.on('scroll', onScrollFunction);
        this.dom.$list.on('DOMMouseScroll mousewheel', scrollFreezeFunction);
        

        // Prevent triggering blur anywhere within $results box;
        self.preventBlur(this.dom.$results);

        // Make sure we don't call box.click when input field was clicked 
        this.dom.$elem.click(function (event) {
            event.stopPropagation();
        });

        // Attach click event for arrow
        this.dom.$arrow.click(function (event) {
            // Same event as down arrow on keyboard
            //self.activate();
            /*if (!self.showingResults_) {
                self.dom.$elem.focus();
            }*/
            self.dom.$elem.focus();
            event.preventDefault();
            return false;
        });

        /**
         * Events functions
         * Use a timeout because instant blur gives race conditions
         */
                    

        /**
         * Catch a race condition on form submit
         */
        $elem.parents('form').on('submit', onBlurFunction);

        this.enable();
    };

    $.Autocompleter.prototype.preventBlur = function($element) {
        var self = this;
        $element.on('mouseenter', function() {
            self.isMouseOverControlElement_ = true;
        });

        $element.on('mouseleave', function() {
            self.isMouseOverControlElement_ = false;
        });
    };
    
    
    /**
     * Set Extra Box Element
     * @public
     */
    $.Autocompleter.prototype.setFloat = function ($float) {
        var self = this;
        this.dom.$extra = $('<div></div>', {"class": this.options.resultsClass + " acResultsFloat"}).hide().css({
            position: 'absolute', top: 0
        });

        self.preventBlur(this.dom.$extra);

        this.dom.$extra.append($float);

        this.dom.$elem.parent().parent().parent().append(this.dom.$extra);
        
    };


    /**
     * Set timeout to activate autocompleter
     */
    $.Autocompleter.prototype.activate = function () {
        var self = this;
        if (this.keyTimeout_) {
            clearTimeout(this.keyTimeout_);
        }
        this.keyTimeout_ = setTimeout(function () {
            
            if (self.lastSelectedValue_ == null) {
                var value = self.getValue();
                self.lastSelectedValue_ = value;
                self.setAcValue(self.lastSelectedValue_);
                self.setValue('');               
            }
            
            self.activateNow();
            
        }, this.options.delay);
    };

    /**
     * Activate autocompleter immediately
     */
    $.Autocompleter.prototype.activateNow = function () {
        var self = this;
        self.dom.$box.addClass("acActive");

        var value = this.beforeUseConverter(this.dom.$elem.val());
        if ((value !== this.lastProcessedValue_) || (this.lastKeyPressed_ === 46 || this.lastKeyPressed_ === 8)) {
            this.fetchData(value);
        }
    };


    /**
     * Position output DOM elements
     * @private
     */
    $.Autocompleter.prototype.position = function () {
        var itemsAvailable, $items;
        

        // First we need to resize $results to fit desired number of items
        if (this.itemHeight_) {
            $items = this.getItems(true);
            itemsAvailable = $items.length < this.options.maxItemsToShow ? $items.length : this.options.maxItemsToShow;

            this.dom.$list.height(this.itemHeight_ * itemsAvailable);
        }

        var offset = this.dom.$box.position();
        var height = this.dom.$results.outerHeight();
        var totalHeight = $(window).outerHeight();
        var inputBottom = offset.top + this.dom.$box.outerHeight();
        var bottomIfDown = inputBottom + height;
        // Set autocomplete results at the bottom of input
        var position = {top: inputBottom, left: offset.left};
        if (bottomIfDown > totalHeight) {
            // Try to set autocomplete results at the top of input
            var topIfUp = offset.top - height;
            if (topIfUp >= 0) {
                position.top = topIfUp;
            }
        }
        this.dom.$results.css(position);

        if (this.dom.$extra) {
            var extraHeight = this.dom.$extra.outerHeight();
            var extraPosition = { top: inputBottom + height, left: offset.left };

            this.dom.$extra.css(extraPosition);
        }

        if (this.options.autoWidth) {
            var autoWidth = this.dom.$box.outerWidth() - this.dom.$results.outerWidth() + this.dom.$results.width();
            //this.dom.$results.css(this.options.autoWidth, autoWidth);
            $('>ul', this.dom.$results).css(this.options.autoWidth, autoWidth); // AR - IE7 - set correct width on the list too otherwise scrollbar is in the middle of div
            
            if (this.dom.$extra) {
                // We need to calculate it again because it may have padding
                autoWidth = this.dom.$box.outerWidth() - this.dom.$extra.outerWidth() + this.dom.$extra.width();
                this.dom.$extra.css(this.options.autoWidth, autoWidth);
            }
        }
    };

    /**
     * Read from cache
     * @private
     */
    $.Autocompleter.prototype.cacheRead = function(filter) {
        var filterLength, searchLength, search, maxPos, pos;
        if (this.options.useCache) {
            filter = String(filter);
            filterLength = filter.length;
            if (this.options.matchSubset) {
                searchLength = 1;
            } else {
                searchLength = filterLength;
            }
            while (searchLength <= filterLength) {
                if (this.options.matchInside) {
                    maxPos = filterLength - searchLength;
                } else {
                    maxPos = 0;
                }
                pos = 0;
                while (pos <= maxPos) {
                    search = filter.substr(0, searchLength);
                    if (this.cacheData_[search] !== undefined) {
                        return this.cacheData_[search];
                    }
                    pos++;
                }
                searchLength++;
            }
        }
        return false;
    };

    /**
     * Write to cache
     * @private
     */
    $.Autocompleter.prototype.cacheWrite = function(filter, data) {
        if (this.options.useCache) {
            if (this.cacheLength_ >= this.options.maxCacheLength) {
                this.cacheFlush();
            }
            filter = String(filter);
            if (this.cacheData_[filter] !== undefined) {
                this.cacheLength_++;
            }
            this.cacheData_[filter] = data;
            return this.cacheData_[filter];
        }
        return false;
    };

    /**
     * Flush cache
     * @public
     */
    $.Autocompleter.prototype.cacheFlush = function() {
        this.cacheData_ = {};
        this.cacheLength_ = 0;
    };

    /**
     * Disables the input
     * @public
     */
    $.Autocompleter.prototype.disable = function () {
        /*if (this.showingResults_) {*/
            
        //}
        
        this.deactivate();
        
        this.dom.$box.addClass("acDisabled");
        
        this.dom.$arrow.hide();
        this.dom.$acelem.hide();
        this.dom.$elem.hide();
        
        var value = this.getValue();
        /*if (value.length == 0) {
            value = this.lastSelectedValue_;
        }*/
        this.dom.$text.html(value);
        this.dom.$text.show();


        this.dom.$box.off('click');
    };
    

    /**
     * Enables the input
     * @public
     */
    $.Autocompleter.prototype.enable = function () {
        var self = this;
        
        // Hide Text
        this.dom.$text.hide();
        
        // Show input fields + arrow
        this.dom.$arrow.show();
        this.dom.$acelem.show();
        this.dom.$elem.show();

        // Mark box as enabled
        this.dom.$box.removeClass("acDisabled");
        
        // Bind box clicking event
        this.dom.$box.on('click', function() {
            self.dom.$elem.focus();
        });
    };
    

    /**
     * Deletes all traces of the input from DOM
     * @public
     */
    $.Autocompleter.prototype.cleanDOM = function () {
        this.dom.$box.remove();
        this.dom.$results.remove();
        this.dom.$extra.remove();
    };

    /**
     * Call hook
     * Note that all called hooks are passed the autocompleter object
     * @param {string} hook
     * @param data
     * @returns Result of called hook, false if hook is undefined
     */
    $.Autocompleter.prototype.callHook = function(hook, data) {
        var f = this.options[hook];
        if (f && $.isFunction(f)) {
            return f(data, this);
        }
        return false;
    };   

    /**
     * Get autocomplete data for a given value
     * @param {string} value Value to base autocompletion on
     * @private
     */
    $.Autocompleter.prototype.fetchData = function(value, fetchNext) {
        var self = this;
        
        if (!fetchNext) {
            self.numFetched_ = 0;
        }
            
        var processResults = function(results, filter, append) {
            if (self.options.processData) {
                results = self.options.processData(results);
            }
            
            if ((!append && results.length === self.options.numLoadInitial) || (append && results.length === self.options.numLoadSubsequent)) {
                self.numFetched_ += results.length;
            } else {
                // We got less records than we've asked
                if (results !== false) {
                    self.numFetched_ = -1;
                }
            }           

            self.showResults(self.filterResults(results, filter), filter, append, results === false);
        };
        if (!fetchNext) {
            this.lastProcessedValue_ = value;
        }
        
        if (value.length < this.options.minChars) {
            processResults([], value);
        } else if (this.options.data) {
            processResults(this.options.data, value);
        } else {
            this.fetchRemoteData(value, fetchNext, function (remoteData, append) {
                processResults(remoteData, value, append);
            });
        }
    };

    /**
     * Get remote autocomplete data for a given value
     * @param {string} filter The filter to base remote data on
     * @param {function} callback The function to call after data retrieval
     * @private
     */
    $.Autocompleter.prototype.fetchRemoteData = function (filter, fetchNext, callback) {
        var self = this;
        var limit = this.options.numLoadInitial,
            skip = 0;

        // We want to make sure not to sumbmit any requests where skip=-1
        if (self.numFetched_ === -1) return;

        var data = this.cacheRead(filter);
        if (data) {
            callback(data);
        } else {
            
            var dataType = self.options.remoteDataType === 'json' ? 'json' : 'text';
            var ajaxCallback = function(data) {
                var parsed = false;
                if (data !== false) {
                    parsed = self.parseRemoteData(data);
                    self.cacheWrite(filter, parsed);
                }
                self.dom.$elem.removeClass(self.options.loadingClass);
                callback(parsed, fetchNext);
            };
            this.dom.$elem.addClass(this.options.loadingClass);

            // Figure out limits
            if (fetchNext) {
                limit = this.options.numLoadSubsequent;
                skip = this.numFetched_;
            } 
            
            var urlData = this.options.onBuildUrl(filter, skip, limit);
            
            // Cancel previous request (only if its different than current request)
            if (this.fetchRemoteRequest_) {
                if (!(deepObjectCompare(urlData,this.fetchRemoteRequestData_))) {
                    this.fetchRemoteRequest_.abort();
                    this.fetchRemoteRequest_ = null;
                } else {
                    return;
                }
            }

            this.fetchRemoteRequestData_ = urlData;
            this.fetchRemoteRequest_ = $.ajax({
                url: urlData.url,
                method: urlData.method || "GET",
                data: urlData.params,
                success: ajaxCallback,
                error: function (jqXHR, textStatus, errorThrown) {
                    if($.isFunction(self.options.onError)) {
                        self.options.onError(jqXHR, textStatus, errorThrown);
                    } else {
                        if (textStatus !== "abort") // null here means it was aborted and no new request has been issued
                        {
                            ajaxCallback(false);
                        }
                    }
                },
                complete: function() {
                    self.fetchRemoteRequest_ = null;
                    self.fetchRemoteRequestUrl_ = null;
                },
                dataType: dataType
            });
        }
    };

    /**
     * Create or update an extra parameter for the remote request
     * @param {string} name Parameter name
     * @param {string} value Parameter value
     * @public
     */
    $.Autocompleter.prototype.setExtraParam = function (name, value) {
        var index = $.trim(String(name));
        if (index) {
            if (!this.options.extraParams) {
                this.options.extraParams = {};
            }
            if (this.options.extraParams[index] !== value) {
                this.options.extraParams[index] = value;
                this.cacheFlush();
                if (this.showingResults_) {
                    this.lastProcessedValue_ = null;
                    this.activateNow();
                }
            }
        }

        return this;
    };

    /**
     * Build the url for a remote request
     * If options.queryParamName === false, append query to url instead of using a GET parameter
     * @param {string} param The value parameter to pass to the backend
     * @returns {string} The finished url with parameters
     */
    /*
    $.Autocompleter.prototype.makeUrl = function(param, fetchNext) {
        var self = this;
        var url = this.options.url;
        var limitParams = {};

        if (this.options.limitParam) {
            if (fetchNext) {
                limitParams[this.options.limitParam] = this.options.numLoadSubsequent;
                limitParams[this.options.skipParam] = this.numFetched_;
            } else {
                limitParams[this.options.limitParam] = this.options.numLoadInitial;
                limitParams[this.options.skipParam] = 0;
            }
        }

        this.options.onBuildUrl(param,)
    
        var params = $.extend({}, this.options.extraParams, limitParams);

        if (this.options.queryParamName === false) {
            url += encodeURIComponent(param);
        } else {
            params[this.options.queryParamName] = param;
        }
        //this.options.generateUrl(param, )

        return makeUrl(url, params);
    };*/

    /**
     * Parse data received from server
     * @param remoteData Data received from remote server
     * @returns {array} Parsed data
     */
    $.Autocompleter.prototype.parseRemoteData = function(remoteData) {
        var remoteDataType;
        var data = remoteData;
        if (this.options.remoteDataType === 'json') {
            remoteDataType = typeof(remoteData);
            switch (remoteDataType) {
                case 'object':
                    data = remoteData;
                    break;
                case 'string':
                    data = $.parseJSON(remoteData);
                    break;
                default:
                    throw new Error("Unexpected remote data type: " + remoteDataType);
            }
            return data;
        }
        return plainTextParser(data, this.options.lineSeparator, this.options.cellSeparator);
    };

    /**
     * Default filter for results
     * @param {Object} result
     * @param {String} filter
     * @returns {boolean} Include this result
     * @private
     */
    $.Autocompleter.prototype.defaultFilter = function(result, filter) {
        if (!result.value) {
            return false;
        }
        if (this.options.filterResults) {
            var pattern = this.matchStringConverter(filter);
            var testValue = this.matchStringConverter(result.value);
            if (!this.options.matchCase) {
                pattern = pattern.toLowerCase();
                testValue = testValue.toLowerCase();
            }
            var patternIndex = testValue.indexOf(pattern);
            if (this.options.matchInside) {
                return patternIndex > -1;
            } else {
                return patternIndex === 0;
            }
        }
        return true;
    };

    /**
     * Filter result
     * @param {Object} result
     * @param {String} filter
     * @returns {boolean} Include this result
     * @private
     */
    $.Autocompleter.prototype.filterResult = function(result, filter) {
        // No filter
        if (this.options.filter === false) {
            return true;
        }
        // Custom filter
        if ($.isFunction(this.options.filter)) {
            return this.options.filter(result, filter);
        }
        // Default filter
        return this.defaultFilter(result, filter);
    };

    /**
     * Filter results
     * @param results
     * @param filter
     */
    $.Autocompleter.prototype.filterResults = function(results, filter) {
        var filtered = [];
        var i, result;

        for (i = 0; i < results.length; i++) {
            result = sanitizeResult(results[i]);
            if (this.filterResult(result, filter)) {
                filtered.push(result);
            }
        }
        if (this.options.sortResults) {
            filtered = this.sortResults(filtered, filter);
        }
        /*
        if (this.options.maxItemsToShow > 0 && this.options.maxItemsToShow < filtered.length) {
            filtered.length = this.options.maxItemsToShow;
        }*/
        return filtered;
    };

    /**
     * Sort results
     * @param results
     * @param filter
     */
    $.Autocompleter.prototype.sortResults = function(results, filter) {
        var self = this;
        var sortFunction = this.options.sortFunction;
        if (!$.isFunction(sortFunction)) {
            sortFunction = function(a, b, f) {
                return sortValueAlpha(a, b, self.options.matchCase);
            };
        }
        results.sort(function(a, b) {
            return sortFunction(a, b, filter, self.options);
        });
        return results;
    };

    /**
     * Convert string before matching
     * @param s
     * @param a
     * @param b
     */
    $.Autocompleter.prototype.matchStringConverter = function(s, a, b) {
        var converter = this.options.matchStringConverter;
        if ($.isFunction(converter)) {
            s = converter(s, a, b);
        }
        return s;
    };

    /**
     * Convert string before use
     * @param s
     * @param a
     * @param b
     */
    $.Autocompleter.prototype.beforeUseConverter = function(s, a, b) {
        s = this.getValue();
        var converter = this.options.beforeUseConverter;
        if ($.isFunction(converter)) {
            s = converter(s, a, b);
        }
        return s;
    };

    /**
     * Enable finish on blur event
     */
    $.Autocompleter.prototype.enableFinishOnBlur = function() {
        this.finishOnBlur_ = true;
    };

    /**
     * Disable finish on blur event
     */
    $.Autocompleter.prototype.disableFinishOnBlur = function() {
        this.finishOnBlur_ = false;
    };

    /**
     * Create a results item (LI element) from a result
     * @param result
     */
    $.Autocompleter.prototype.createItemFromResult = function(result) {
        var self = this;
        var $li = $('<li/>');
        $li.html(this.showResult(result.value, result.data));
        $li.data({value: result.value, data: result.data})
            .click(function() {
                self.selectItem($li);
            })
            .mousedown(self.disableFinishOnBlur)
            .mouseup(self.enableFinishOnBlur)
        ;
        return $li;
    };

    /**
     * Get all items from the results list
     * @param result
     */
    $.Autocompleter.prototype.getItems = function (allItems) {
        var itemsCache = this.$itemsCache_;
        if (!itemsCache) {
            itemsCache = {};
        }

        var results;
        if (allItems) {
            if (!itemsCache.all) {
                itemsCache.all = $('>ul>li', this.dom.$results);
            }
            results = itemsCache.all;
        } else {
            if (!itemsCache.selecable) {
                itemsCache.selecable = $('>ul>li', this.dom.$results).not(".acNoSelect");;

            }
            results = itemsCache.selecable;
        }

        return results;
    };

    /**
     * Show all results
     * @param results
     * @param filter
     */
    $.Autocompleter.prototype.showResults = function(results, filter, append, isError) {
        var numResults = results.length;
        var self = this;
        
        // reset items cache
        this.$itemsCache_ = null;

        if (!append) {
            this.dom.$list.empty();
        }
        var i, result, $li, first = false, $first = false;

        if (numResults) {
            for (i = 0; i < numResults; i++) {
                result = results[i];
                $li = this.createItemFromResult(result);
                this.dom.$list.append($li);

                if (!append) {
                    if (first === false) {
                        first = String(result.value);
                        $first = $li;
                        $li.addClass(this.options.firstItemClass);
                    }
                    if (i === numResults - 1) {
                        $li.addClass(this.options.lastItemClass);
                    }
                }
            }
        } else {            
            if (!append) {                
                $li = this.createItemFromNoResult(isError ? "Error retreiving locations." : null);
                this.dom.$list.append($li);
                $first = $li;
                this.setAcValue('');
            }
        }

        this.dom.$results.show();
            
        if (this.dom.$extra) {
            this.dom.$extra.show();
        }
            
        // Fix for FF that scrolls the list to the bottom after creation
        if (!append) {
            setTimeout(function () {
                self.dom.$list.scrollTop(0);
            }, 0);                
        }
            
        // grab height of one item
        if (!self.itemHeight_) {
            self.itemHeight_ = $first.outerHeight();
        }

        // Always recalculate position since window size or
        // input element location may have changed.
        this.position();
                
        var items = this.getItems();
            
        // unbind events from existing items
        if (append) {
            items.unbind('mouseenter mouseleave');
        }

        items.hover(
            function () {
                if (self.isScrolling === false) {
                    self.focusItem(this);
                } 
            },
            function() { /* void */ }
        );
        
        if (!append) {
            if (numResults && (this.autoFill(first, filter) || this.options.selectFirst || (this.options.selectOnly && numResults === 1))) {
                this.focusItem($first);
            }
            this.showingResults_ = true;
        }       
    };

    $.Autocompleter.prototype.createItemFromNoResult = function (message) {
        var messageToDisplay = message || this.options.noMatchMessage;
        var $li = $('<li></li>').text(messageToDisplay).addClass("acNoSelect");
        return $li;
    };

    $.Autocompleter.prototype.showResult = function(value, data) {
        if ($.isFunction(this.options.showResult)) {
            return this.options.showResult(value, data);
        } else {
            return $('<p></p>').text(value).html();
        }
    };

    $.Autocompleter.prototype.autoFill = function (value, filter) {
        var lcValue, lcFilter, filterLength;
        
       if (this.options.autoFill) {
            lcValue = String(value).toLowerCase();
            lcFilter = String(filter).toLowerCase();
            filterLength = filter.length;
           if (filterLength > 0) {
               if (lcValue.substr(0, filterLength) === lcFilter) {
                   // NOTE: Delimiter is not handled)

                   this.lastProcessedValue_ = value.substr(0, filterLength);

                   // We only set the value if case needs to be changed
                   if (value.substr(0, filterLength) !== filter) {
                       this.setValue(this.lastProcessedValue_);
                   }

                   this.setAcValue(value);
               } else {
                   this.setAcValue('');
               }
               return true;
           } else {               
               // filterLength == 0
               this.setAcValue(this.lastSelectedValue_);
           }
       }
        return false;
    };
    
    $.Autocompleter.prototype.focusPageDown = function () {
        this.focusMove(+this.options.maxItemsToShow);
    };
    
    $.Autocompleter.prototype.focusPageUp = function () {
        this.focusMove(-this.options.maxItemsToShow);
    };

    $.Autocompleter.prototype.focusNext = function() {
        this.focusMove(+1);
    };

    $.Autocompleter.prototype.focusPrev = function() {
        this.focusMove(-1);
    };

    $.Autocompleter.prototype.focusMove = function(modifier) {
        var $items = this.getItems();
        modifier = sanitizeInteger(modifier, 0);
        if (modifier) {
            for (var i = 0; i < $items.length; i++) {
                if ($($items[i]).hasClass(this.selectClass_)) {
                    this.focusItem(i + modifier);
                    return;
                }
            }
        }
        this.focusItem(0);
    };

    $.Autocompleter.prototype.focusItem = function (item) {
        var $item, $items = this.getItems(), $selectedItems = $items.filter("." + this.selectClass_);
        if ($items.length) {
            $selectedItems.removeClass(this.selectClass_).removeClass(this.options.selectClass);
            if (typeof item === 'number') {
                if (item < 0) {
                    item = 0;
                } else if (item >= $items.length) {
                    item = $items.length - 1;
                }
                $item = $($items[item]);
            } else {
                $item = $(item);
            }
            if ($item) {
                
                $item.addClass(this.selectClass_).addClass(this.options.selectClass);
                this.scrollItemIntoView($item);
                /*var value = $item.data('value');
                if (value.substr(0, this.lastProcessedValue_.length) !== this.lastProcessedValue_) {
                    this.setValue('');
                    this.setAcValue(value);
                } else {
                    this.setValue(this.lastProcessedValue_);
                    this.setAcValue(value);                    
                }*/
            }
        }
    };
    
    /**
     * Scroll suggestion item into view (based on https://github.com/alexgorbatchev/jquery-textext/blob/master/src/js/textext.plugin.autocomplete.js)
     * @param {Number} pos
     */
    $.Autocompleter.prototype.scrollItemIntoView = function ($item) {
        var itemHeight = $item.outerHeight(),
            dropdown = this.dom.$list,
            dropdownHeight = dropdown.innerHeight(),
            scrollPos = dropdown.scrollTop(),
            itemTop = ($item.position() || {}).top,
            scrollTo = null,
            paddingTop = parseInt(dropdown.css('paddingTop')),
            self = this;
        
        if (itemTop == null)
            return;

        // if scrolling down and item is below the bottom fold
        if (itemTop + itemHeight > dropdownHeight)
            scrollTo = itemTop + itemHeight + scrollPos - dropdownHeight + paddingTop;

        // if scrolling up and item is above the top fold
        if (itemTop < 0)
            scrollTo = itemTop + scrollPos - paddingTop;

        if (scrollTo != null) {
            this.isScrolling = true;
            dropdown.scrollTop(scrollTo);
            
            // Allow hovers to be handled 100ms after scrolling
            if (this.scrollingTimer) clearTimeout(this.scrollingTimer);
            this.scrollingTimer = setTimeout(function () {
                self.isScrolling = false;
            }, 100);
        }
    };

    $.Autocompleter.prototype.selectCurrent = function(skipFocus) {
        var $item = $('li.' + this.selectClass_, this.dom.$results);
        if ($item.length === 1) {
            this.selectItem($item, skipFocus);
        } else {
            this.deactivate();
        }
    };

    $.Autocompleter.prototype.selectItem = function ($li, skipFocus) {        
        var value = $li.data('value');
        var data = $li.data('data');
        var displayValue = this.displayValue(value, data);
        var processedDisplayValue = this.beforeUseConverter(displayValue);
        this.lastProcessedValue_ = processedDisplayValue;
        this.lastSelectedValue_ = processedDisplayValue;
        var d = this.getDelimiterOffsets();
        var delimiter = this.options.delimiterChar;
        var elem = this.dom.$elem;
        var extraCaretPos = 0;
        if ( this.options.useDelimiter ) {
            // if there is a preceding delimiter, add a space after the delimiter
            if ( elem.val().substring(d.start-1, d.start) === delimiter && delimiter !== ' ' ) {
                displayValue = ' ' + displayValue;
            }
            // if there is not already a delimiter trailing this value, add it
            if ( elem.val().substring(d.end, d.end+1) !== delimiter && this.lastKeyPressed_ !== this.options.delimiterKeyCode ) {
                displayValue = displayValue + delimiter;
            } else {
                // move the cursor after the existing trailing delimiter
                extraCaretPos = 1;
            }
        }
        this.setValue(displayValue);
        this.setAcValue("");
        this.callHook('onItemSelect', { value: value, data: data });
        this.deactivate();
        /*if (!skipFocus) {
            this.setCaret(d.start + displayValue.length + extraCaretPos);
            elem.focus();
        }*/
    };

    $.Autocompleter.prototype.displayValue = function(value, data) {
        if ($.isFunction(this.options.displayValue)) {
            return this.options.displayValue(value, data);
        }
        return value;
    };

    $.Autocompleter.prototype.hideResults = function() {
        this.dom.$results.hide();
        if (this.dom.$extra) {
            this.dom.$extra.hide();
        }
        this.showingResults_ = false;
    };

    $.Autocompleter.prototype.deactivate = function(skipBlur) {
        if (this.blurTimeout_) {
            clearTimeout(this.blurTimeout_);
        }
        if (this.keyTimeout_) {
            clearTimeout(this.keyTimeout_);
        }
        
        if (this.focusTimeout_) {
            clearTimeout(this.focusTimeout_);
        }

        // Select value
        if (this.lastProcessedValue_ !== this.lastSelectedValue_) {
            if (this.options.mustMatch) {
                if (this.lastSelectedValue_ != null && this.lastSelectedValue_.length > 0) {
                    this.setValue(this.lastSelectedValue_);
                } else {
                    this.setValue('');
                }
            }
            this.callHook('onNoMatch');
        }
        if (this.showingResults_) {
            this.callHook('onFinish');
        }
        
        this.lastKeyPressed_ = null;
        this.lastProcessedValue_ = null;
        this.lastSelectedValue_ = null;
        
        this.setAcValue('');
        this.hideResults();
        this.dom.$box.removeClass("acActive");
        
        // blur
        //if (!skipBlur) 
        // Leave the field
        this.dom.$elem.blur();
    };

    $.Autocompleter.prototype.selectRange = function(start, end) {
        var input = this.dom.$elem.get(0);
        if (input.setSelectionRange) {
            input.focus();
            input.setSelectionRange(start, end);
        } else if (input.createTextRange) {
            var range = input.createTextRange();
            range.collapse(true);
            range.moveEnd('character', end);
            range.moveStart('character', start);
            range.select();
        }
    };   

    /**
     * Move caret to position
     * @param {Number} pos
     */
    $.Autocompleter.prototype.setCaret = function(pos) {
        this.selectRange(pos, pos);
    };

    /**
     * Get caret position
     */
    $.Autocompleter.prototype.getCaret = function() {
        var $elem = this.dom.$elem;
        var elem = $elem[0];
        var val, selection, range, start, end, stored_range;
        if (elem.createTextRange) { // IE
            selection = document.selection;
            if (elem.tagName.toLowerCase() != 'textarea') {
                val = $elem.val();
                range = selection.createRange().duplicate();
                range.moveEnd('character', val.length);
                if (range.text === '') {
                    start = val.length;
                } else {
                    start = val.lastIndexOf(range.text);
                }
                range = selection.createRange().duplicate();
                range.moveStart('character', -val.length);
                end = range.text.length;
            } else {
                range = selection.createRange();
                stored_range = range.duplicate();
                stored_range.moveToElementText(elem);
                stored_range.setEndPoint('EndToEnd', range);
                start = stored_range.text.length - range.text.length;
                end = start + range.text.length;
            }
        } else {
            start = $elem[0].selectionStart;
            end = $elem[0].selectionEnd;
        }
        return {
            start: start,
            end: end
        };
    };

    /**
     * Set the value that is currently being autocompleted
     * @param {String} value
     */
    $.Autocompleter.prototype.setValue = function (value) {
        if ( this.options.useDelimiter ) {
            // set the substring between the current delimiters
            var val = this.dom.$elem.val();
            var d = this.getDelimiterOffsets();
            var preVal = val.substring(0, d.start);
            var postVal = val.substring(d.end);
            value = preVal + value + postVal;
        }
        this.dom.$elem.val(value);
    };
    
    /**
     * Set the autocomplete value that is currently being autocompleted
     * @param {String} value
     */
    $.Autocompleter.prototype.setAcValue = function (value) {
        // NOTE: delimiter is not handled
        if (this.options.useDelimiter) {
            // set the substring between the current delimiters
            var val = this.dom.$elem.val();
            var d = this.getDelimiterOffsets();
            var preVal = val.substring(0, d.start);
            var postVal = val.substring(d.end);
            value = preVal + value + postVal;
        }
        this.dom.$acelem.val(value);
    };

    /**
     * Get the value currently being autocompleted
     * @param {String} value
     */
    $.Autocompleter.prototype.getValue = function() {
        var val = this.dom.$elem.val();
        if ( this.options.useDelimiter ) {
            var d = this.getDelimiterOffsets();
            return val.substring(d.start, d.end).trim();
        } else {
            return val;
        }
    };

    /**
     * Get the offsets of the value currently being autocompleted
     */
    $.Autocompleter.prototype.getDelimiterOffsets = function() {
        var val = this.dom.$elem.val(),
            start,
            end;
        if ( this.options.useDelimiter ) {
            var preCaretVal = val.substring(0, this.getCaret().start);
            start = preCaretVal.lastIndexOf(this.options.delimiterChar) + 1;
            var postCaretVal = val.substring(this.getCaret().start);
            end = postCaretVal.indexOf(this.options.delimiterChar);
            if ( end === -1 ) end = val.length;
            end += this.getCaret().start;
        } else {
            start = 0;
            end = val.length;
        }
        return {
            start: start,
            end: end
        };
    };

})(jQuery);
