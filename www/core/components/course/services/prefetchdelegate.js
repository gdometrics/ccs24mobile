// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.core')

/**
 * Delegate to register prefetch handlers.
 *
 * @module mm.core
 * @ngdoc service
 * @name $mmCoursePrefetchDelegate
 * @description
 *
 * To register a prefetch handler:
 *
 * .config(function($mmCoursePrefetchDelegateProvider) {
 *     $mmCoursePrefetchDelegateProvider.registerPrefetchHandler('mmaYourAddon', 'moduleName', 'handlerName');
 * })
 *
 * To see the methods that must provide the prefetch handler see {@link $mmCoursePrefetchDelegateProvider#registerPrefetchHandler}.
 */
.provider('$mmCoursePrefetchDelegate', function() {
    var prefetchHandlers = {},
        self = {};

    /**
     * Register a prefetch handler.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmCoursePrefetchDelegateProvider#registerPrefetchHandler
     * @param {String} addon The addon's name (mmaLabel, mmaForum, ...)
     * @param {String} handles The module this handler handles, e.g. forum, label.
     * @param {String|Object|Function} handler Must be resolved to an object defining the following functions. Or to a function
     *                           returning an object defining these properties. See {@link $mmUtil#resolveObject}.
     *                             - component (String) Handler's component.
     *                             - getDownloadSize(module, courseid) (Number|Promise) Get the download size of a module.
     *                             - isEnabled() (Boolean|Promise) Whether or not the handler is enabled on a site level.
     *                             - prefetch(module, courseid, single) (Promise) Prefetches a module.
     *                             - (Optional) getFiles(module, courseid) (Object[]|Promise) Get list of files. If not defined,
     *                                                                      we'll assume they're in module.contents.
     *                             - (Optional) determineStatus(status) (String) Returns status to show based on current. E.g. for
     *                                                                 books we'll show "outdated" even if state is "downloaded".
     *                             - (Optional) getRevision(module, courseid) (String|Number|Promise) Returns the module revision.
     *                                                                 If not defined we'll calculate it using module files.
     *                             - (Optional) getTimemodified(module, courseid) (Number|Promise) Returns the module timemodified.
     *                                                                 If not defined we'll calculate it using module files.
     *                             - (Optional) isDownloadable(module, courseid) (Boolean|Promise) Check if a module can be
     *                                                                 downloaded. If function is not defined, we assume that all
     *                                                                 modules will be downloadable.
     *                             - (Optional) invalidateModule(module, courseId) (Promise) Invalidates WS calls needed to
     *                                                                 determine module status. This should NOT invalidate files
     *                                                                 nor all the prefetched data.
     */
    self.registerPrefetchHandler = function(addon, handles, handler) {
        if (typeof prefetchHandlers[handles] !== 'undefined') {
            console.log("$mmCoursePrefetchDelegateProvider: Addon '" + prefetchHandlers[handles].addon +
                            "' already registered as handler for '" + handles + "'");
            return false;
        }
        console.log("$mmCoursePrefetchDelegateProvider: Registered addon '" + addon + "' as prefetch handler.");
        prefetchHandlers[handles] = {
            addon: addon,
            handler: handler,
            instance: undefined
        };
        return true;
    };

    self.$get = function($q, $log, $mmSite, $mmUtil, $mmFilepool, $mmEvents, mmCoreDownloaded, mmCoreDownloading,
                mmCoreNotDownloaded, mmCoreOutdated, mmCoreNotDownloadable, mmCoreEventSectionStatusChanged, $mmFS) {
        var enabledHandlers = {},
            self = {},
            deferreds = {},
            lastUpdateHandlersStart;

        $log = $log.getInstance('$mmCoursePrefetchDelegate');

        /**
         * Clear the status cache (memory object).
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#clearStatusCache
         * @return {Void}
         */
        self.clearStatusCache = function() {
            statusCache.clear();
        };

        /**
         * Invalidates the status cache for a given module.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#invalidateModuleStatusCache
         * @param  {Object} module      Module to be invalidated.
         * @return {Void}
         */
        self.invalidateModuleStatusCache = function(module) {
            var handler = enabledHandlers[module.modname];
            if (handler) {
                // Invalidate Status of the module.
                statusCache.invalidate(handler.component, module.id);
            }
        };

        // To speed up the getModulesStatus function.
        var statusCache = new function() {
            var cacheStore = {};

            this.clear = function() {
                cacheStore = {};
            };

            /**
             * Get the status of a module from the "cache".
             *
             * @param {String} component     Package's component.
             * @param {Mixed} [componentId]  An ID to use in conjunction with the component.
             * @return {Object} Cached status
             */
            this.get = function(component, componentId) {
                var packageId = $mmFilepool.getPackageId(component, componentId);

                if (!cacheStore[packageId]) {
                    cacheStore[packageId] = {};
                }

                return cacheStore[packageId];
            };

            /**
             * Get the status of a module from the "cache".
             *
             * @param {String}  component           Package's component.
             * @param {Mixed}   [componentId]       An ID to use in conjunction with the component.
             * @param {String}  name                Name of the value to be set.
             * @param {Boolean} [ignoreInvalidate]  If ignore or not the lastupdate value that invalidates data.
             * @return {Mixed}  Cached value.
             */
            this.getValue = function(component, componentId, name, ignoreInvalidate) {
                var cache = this.get(component, componentId);

                if (typeof cache[name] != "undefined") {
                    var now = new Date().getTime();
                    // Invalidate after 5 minutes.
                    if (!ignoreInvalidate || cache.lastupdate + 300000 >= now) {
                        return cache[name];
                    }
                }

                return false;
            };

            /**
             * Update the status of a module in the "cache".
             *
             * @param {String}  component       Package's component.
             * @param {Mixed}   [componentId]   An ID to use in conjunction with the component.
             * @param {String}  name            Name of the value to be set.
             * @param {Mixed}   value           Value to be set.
             * @return {Mixed}  The value set.
             */
            this.setValue = function(component, componentId, name, value) {
                var cache = this.get(component, componentId);

                cache[name] = value;
                cache.lastupdate = new Date().getTime();

                return value;
            };

            /**
             * Invalidate the cache.
             *
             * @param {String}  component       Package's component.
             * @param {Mixed}   [componentId]   An ID to use in conjunction with the component.
             */
            this.invalidate = function(component, componentId) {
                var packageId = $mmFilepool.getPackageId(component, componentId);
                delete cacheStore[packageId];
            };
        };

        /**
         * Determines a module status based on current status, restoring downloads if needed.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#determineModuleStatus
         * @param  {Object} module           Module.
         * @param  {String} status           Current status.
         * @param {Boolean} restoreDownloads True if it should restore downloads if needed.
         * @return {String}                  Module status.
         */
        self.determineModuleStatus = function(module, status, restoreDownloads) {
            var handler = enabledHandlers[module.modname];

            if (handler) {
                if (status == mmCoreDownloading && restoreDownloads) {
                    // Check if the download is being handled.
                    if (!$mmFilepool.getPackageDownloadPromise($mmSite.getId(), handler.component, module.id)) {
                        // Not handled, the app was probably restarted or something weird happened.
                        // Re-start download (files already on queue or already downloaded will be skipped).
                        handler.prefetch(module);
                    }
                } else if (handler.determineStatus) {
                    // The handler implements a determineStatus function. Apply it.
                    return handler.determineStatus(status);
                }
            }
            return status;
        };

        /**
         * Get modules download size. Only treat the modules with status not downloaded or outdated.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getDownloadSize
         * @param  {Object[]} modules List of modules.
         * @param  {Number} courseid  Course ID the modules belong to.
         * @return {Promise}          Promise resolved with the download size.
         */
        self.getDownloadSize = function(modules, courseid) {
            var size = 0,
                promises = [];

            angular.forEach(modules, function(module) {
                promises.push(self.getModuleStatus(module, courseid).then(function(modstatus) {
                    // Add the size of the downloadable files if need to be downloaded.
                    if (modstatus === mmCoreNotDownloaded || modstatus === mmCoreOutdated) {
                        return self.getModuleDownloadSize(module, courseid).then(function(modulesize) {
                            size = size + modulesize;
                        });
                    }
                    return $q.when();
                }));
            });

            return $q.all(promises).then(function() {
                return size;
            });
        };

        /**
         * Prefetch module using prefetch handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#prefetchModule
         * @param  {Object} module      Module to be prefetch.
         * @param  {Number} courseid    Course ID the module belongs to.
         * @return {Promise}            Promise resolved when finished.
         */
        self.prefetchModule = function(module, courseid) {
            var handler = enabledHandlers[module.modname];

            // Check if the module has a prefetch handler.
            if (handler) {
                return handler.prefetch(module, courseid);
            }
            return $q.when();
        };

        /**
         * Get Module Download Size from handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getModuleDownloadSize
         * @param  {Object} module      Module to be get info from.
         * @param  {Number} courseid    Course ID the module belongs to.
         * @return {Promise}            Promise with the size.
         */
        self.getModuleDownloadSize = function(module, courseid) {
            var downloadSize,
                handler = enabledHandlers[module.modname];

            // Check if the module has a prefetch handler.
            if (handler) {
                return self.isModuleDownloadable(module, courseid).then(function(downloadable) {
                    if (!downloadable) {
                        return;
                    }

                    downloadSize = statusCache.getValue(handler.component, module.id, 'downloadSize');
                    if (downloadSize !== false) {
                        return downloadSize;
                    }

                    return $q.when(handler.getDownloadSize(module, courseid)).then(function(size) {
                        return statusCache.setValue(handler.component, module.id, 'downloadSize', size);
                    }).catch(function() {
                        return statusCache.getValue(handler.component, module.id, 'downloadSize', true);
                    });
                });
            }

            return $q.when(0);
        };

        /**
         * Get Module Downloaded Size from handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getModuleDownloadedSize
         * @param  {Object} module      Module to be get info from.
         * @param  {Number} courseid    Course ID the module belongs to.
         * @return {Promise}            Promise with the size.
         */
        self.getModuleDownloadedSize = function(module, courseid) {
            var downloadedSize,
                handler = enabledHandlers[module.modname];

            // Check if the module has a prefetch handler.
            if (handler) {
                return self.isModuleDownloadable(module, courseid).then(function(downloadable) {
                    if (!downloadable) {
                        return;
                    }

                    downloadedSize = statusCache.getValue(handler.component, module.id, 'downloadedSize');
                    if (downloadedSize !== false) {
                        return downloadedSize;
                    }

                    return self.getModuleFiles(module, courseid).then(function(files) {
                        var siteId = $mmSite.getId(),
                            promises = [],
                            size = 0;

                        // Retrieve file size if it's downloaded.
                        angular.forEach(files, function(file) {
                            promises.push($mmFilepool.getFilePathByUrl(siteId, file.fileurl).then(function(path) {
                                return $mmFS.getFileSize(path).catch(function () {
                                    return $mmFilepool.isFileDownloadingByUrl(siteId, file.fileurl).then(function() {
                                        // If downloading, count as downloaded.
                                        return file.filesize;
                                    }).catch(function() {
                                        // Not downloading and not found files count like 0 used space.
                                        return 0;
                                    });
                                }).then(function(fs) {
                                    size += fs;
                                });
                            }));
                        });

                        return $q.all(promises).then(function() {
                            return size;
                        });
                    }).then(function(size) {
                        return statusCache.setValue(handler.component, module.id, 'downloadedSize', size);
                    }).catch(function() {
                        return statusCache.getValue(handler.component, module.id, 'downloadedSize', true);
                    });
                });
            }

            return $q.when(0);
        };

        /**
         * Get Module Lastest Timemodified from handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getModuleTimemodified
         * @param  {Object} module      Module to be get info from.
         * @param  {Number} courseid    Course ID the module belongs to.
         * @param  {Array}  [files]     Files of the module.
         * @return {Promise}            Promise with the lastest timemodified.
         */
        self.getModuleTimemodified = function(module, courseid, files) {
            var handler = enabledHandlers[module.modname],
                promise, timemodified;

            if (handler) {
                timemodified = statusCache.getValue(handler.component, module.id, 'timemodified');
                if (timemodified) {
                    return $q.when(timemodified);
                }

                if (handler.getTimemodified) {
                    promise = handler.getTimemodified(module, courseid);
                } else {
                    // Get files if not sent.
                    promise = files ? $q.when(files) : self.getModuleFiles(module, courseid);
                    return promise.then(function(files) {
                        return $mmFilepool.getTimemodifiedFromFileList(files);
                    });
                }

                return $q.when(promise).then(function(timemodified) {
                    return statusCache.setValue(handler.component, module.id, 'timemodified', timemodified);
                }).catch(function() {
                    return statusCache.getValue(handler.component, module.id, 'timemodified', true);
                });
            }

            return $q.reject();
        };

        /**
         * Get Module Lastest Revision number from handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getModuleRevision
         * @param  {Object} module      Module to be get info from.
         * @param  {Number} courseid    Course ID the module belongs to.
         * @param  {Array}  [files]     Files of the module.
         * @return {Promise}            Promise with the lastest revision.
         */
        self.getModuleRevision = function(module, courseid, files) {
            var handler = enabledHandlers[module.modname],
                promise, revision;

            if (handler) {
                revision = statusCache.getValue(handler.component, module.id, 'revision');
                if (revision) {
                    return $q.when(revision);
                }

                if (handler.getRevision) {
                    promise = handler.getRevision(module, courseid).then();
                } else {
                    // Get files if not sent.
                    promise = files ? $q.when(files) : self.getModuleFiles(module, courseid);
                    promise = promise.then(function(files) {
                        return $mmFilepool.getRevisionFromFileList(files);
                    });
                }
                return $q.when(promise).then(function(revision) {
                    return statusCache.setValue(handler.component, module.id, 'revision', revision);
                }).catch(function() {
                    return statusCache.getValue(handler.component, module.id, 'revision', true);
                });
            }

            return $q.reject();
        };

        /**
         * Get Module Files from handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getModuleFiles
         * @param  {Object} module      Module to be get info from.
         * @param  {Number} courseid    Course ID the module belongs to.
         * @return {Promise}            Promise with the lastest revision.
         */
        self.getModuleFiles = function(module, courseid) {
            var handler = enabledHandlers[module.modname];

            // Prevent null contents.
            module.contents = module.contents || [];

            // If the handler doesn't define a function to get the files, use module.contents.
            return handler.getFiles ? $q.when(handler.getFiles(module, courseid)) : $q.when(module.contents);
        };

        /**
         * Remove module Files from handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#removeModuleFiles
         * @param  {Object} module      Module to be get info from.
         * @param  {Number} courseid    Course ID the module belongs to.
         * @return {Promise}            Promise resolved when done.
         */
        self.removeModuleFiles = function(module, courseid) {
            var handler = enabledHandlers[module.modname],
                siteId = $mmSite.getId();

            // Some files cannot be associated with the component+componentId, so the following function cannot be done.
            // $mmFilepool.removeFilesByComponent(siteId, handler.component, module.id);

            // Try to delete all files on content (downloaded or not).
            return self.getModuleFiles(module, courseid).then(function(files) {
                angular.forEach(files, function(file) {
                    return $mmFilepool.removeFileByUrl(siteId, file.fileurl).catch(function() {
                        // Ignore errors.
                    });
                });

                if (handler) {
                    // Update Status of the module.
                    statusCache.setValue(handler.component, module.id, 'downloadedSize', 0);
                    $mmFilepool.storePackageStatus(siteId, handler.component, module.id, mmCoreNotDownloaded);
                }
            });
        };

        /**
         * Get the module status.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getModuleStatus
         * @param {Object} module         Module.
         * @param {Number} courseid       Course ID the module belongs to.
         * @param {Number} [revision]     Module's revision. If not defined, it will be calculated using module data.
         * @param {Number} [timemodified] Module's timemodified. If not defined, it will be calculated using module data.
         * @return {Promise}              Promise resolved with the status.
         */
        self.getModuleStatus = function(module, courseid, revision, timemodified) {
            var handler = enabledHandlers[module.modname],
                siteid = $mmSite.getId();

            if (handler) {
                // Check if the module is downloadable.
                return self.isModuleDownloadable(module, courseid).then(function(downloadable) {
                    if (!downloadable) {
                        return mmCoreNotDownloadable;
                    }

                    var status = statusCache.getValue(handler.component, module.id, 'status');
                    if (status) {
                        return self.determineModuleStatus(module, status, true);
                    }

                    return self.getModuleFiles(module, courseid).then(function(files) {

                        // Get revision and timemodified if they aren't defined.
                        // If handler doesn't define a function to get them, get them from file list.
                        var promises = [];

                        if (typeof revision == 'undefined') {
                            promises.push(self.getModuleRevision(module, courseid, files).then(function(rev) {
                                revision = rev;
                            }));
                        }

                        if (typeof timemodified == 'undefined') {
                            promises.push(self.getModuleTimemodified(module, courseid, files).then(function(timemod) {
                                timemodified = timemod;
                            }));
                        }

                        return $q.all(promises).then(function() {
                            // Now get the status.
                            return $mmFilepool.getPackageStatus(siteid, handler.component, module.id, revision, timemodified)
                                    .then(function(status) {
                                status = statusCache.setValue(handler.component, module.id, 'status', status);
                                return self.determineModuleStatus(module, status, true);
                            }).catch(function() {
                                status = statusCache.getValue(handler.component, module.id, 'status', true);
                                return self.determineModuleStatus(module, status, true);
                            });
                        });
                    });
                });
            }

            // No handler found, module not downloadable.
            return $q.when(mmCoreNotDownloadable);
        };

        /**
         * Get the status of a list of modules, along with the lists of modules for each status.
         * @see {@link $mmFilepool#determinePackagesStatus}
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getModulesStatus
         * @param  {String} sectionid         ID of the section the modules belong to.
         * @param  {Object[]} modules         List of modules to prefetch.
         * @param  {Number} courseid          Course ID the modules belong to.
         * @param  {Boolean} refresh          True if it should always check the DB (slower).
         * @param {Boolean} restoreDownloads  True if it should restore downloads. It's only used if refresh=false,
         *                                    if refresh=true then it always tries to restore downloads.
         * @return {Promise}                  Promise resolved with an object with the following properties:
         *                                            - status (String) Status of the module.
         *                                            - total (Number) Number of modules.
         *                                            - mmCoreNotDownloaded (Object[]) Modules with state mmCoreNotDownloaded.
         *                                            - mmCoreDownloaded (Object[]) Modules with state mmCoreDownloaded.
         *                                            - mmCoreDownloading (Object[]) Modules with state mmCoreDownloading.
         *                                            - mmCoreOutdated (Object[]) Modules with state mmCoreOutdated.
         */
        self.getModulesStatus = function(sectionid, modules, courseid, refresh, restoreDownloads) {

            var promises = [],
                status = mmCoreNotDownloadable,
                result = {};

            // Init result.
            result[mmCoreNotDownloaded] = [];
            result[mmCoreDownloaded] = [];
            result[mmCoreDownloading] = [];
            result[mmCoreOutdated] = [];
            result.total = 0;

            angular.forEach(modules, function(module) {
                // Check if the module has a prefetch handler.
                var handler = enabledHandlers[module.modname],
                    promise;
                // Prevent null contents.
                module.contents = module.contents || [];

                if (handler) {
                    var cacheStatus = statusCache.getValue(handler.component, module.id, 'status');
                    if (!refresh && cacheStatus) {
                        promise = $q.when(self.determineModuleStatus(module, cacheStatus, restoreDownloads));
                    } else {
                        promise = self.getModuleStatus(module, courseid);
                    }

                    promises.push(
                        promise.then(function(modstatus) {
                            if (modstatus != mmCoreNotDownloadable) {
                                // Update status cache.
                                statusCache.setValue(handler.component, module.id, 'sectionid', sectionid);
                                modstatus = statusCache.setValue(handler.component, module.id, 'status', modstatus);

                                status = $mmFilepool.determinePackagesStatus(status, modstatus);
                                result[modstatus].push(module);
                                result.total++;
                            }
                        }).catch(function() {
                            modstatus = statusCache.getValue(handler.component, module.id, 'status', true);
                            if (!modstatus) {
                                return $q.reject();
                            }
                            if (modstatus != mmCoreNotDownloadable) {
                                status = $mmFilepool.determinePackagesStatus(status, modstatus);
                                result[modstatus].push(module);
                                result.total++;
                            }
                        })
                    );
                }
            });

            return $q.all(promises).then(function() {
                result.status = status;
                return result;
            });
        };

        /**
         * Get a prefetch handler.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getPrefetchHandlerFor
         * @param {String} handles The module to work on.
         * @return {Object}        Prefetch handler.
         */
        self.getPrefetchHandlerFor = function(handles) {
            return enabledHandlers[handles];
        };

        /**
         * Invalidate a list of modules in a course. This should only invalidate WS calls, not downloaded files.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#invalidateModules
         * @param  {Object[]} modules List of modules.
         * @param  {Number} courseId  Course ID.
         * @return {Promise}          Promise resolved when modules are invalidated.
         */
        self.invalidateModules = function(modules, courseId) {
            var promises = [];

            angular.forEach(modules, function(module) {
                var handler = enabledHandlers[module.modname];
                if (handler) {
                    if (handler.invalidateModule) {
                        promises.push(handler.invalidateModule(module, courseId).catch(function() {
                            // Ignore errors.
                        }));
                    }

                    // Invalidate cache.
                    statusCache.invalidate(handler.component, module.id);
                }
            });

            return $q.all(promises);
        };

        /**
         * Check if a list of modules is being downloaded.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#isBeingDownloaded
         * @param  {String} id An ID to identify the download.
         * @return {Boolean}   True if it's being downloaded, false otherwise.
         */
        self.isBeingDownloaded = function(id) {
            return deferreds[$mmSite.getId()] && deferreds[$mmSite.getId()][id];
        };

        /**
         * Check if a time belongs to the last update handlers call.
         * This is to handle the cases where updatePrefetchHandlers don't finish in the same order as they're called.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#isLastUpdateCall
         * @param  {Number}  time Time to check.
         * @return {Boolean}      True if equal, false otherwise.
         */
        self.isLastUpdateCall = function(time) {
            if (!lastUpdateHandlersStart) {
                return true;
            }
            return time == lastUpdateHandlersStart;
        };

        /**
         * Check if a module is downloadable.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#isModuleDownloadable
         * @param {Object} module   Module.
         * @param {Number} courseid Course ID the module belongs to.
         * @return {Promise}        Promise resolved with true if downloadable, false otherwise.
         */
        self.isModuleDownloadable = function(module, courseid) {
            var handler = enabledHandlers[module.modname],
                promise;

            if (handler) {
                if (typeof handler.isDownloadable == 'function') {
                    promise = $q.when(handler.isDownloadable(module, courseid));
                } else {
                    promise = $q.when(true); // Function not defined, assume all modules are downloadable.
                }

                return promise.catch(function() {
                    // Something went wrong, assume not downloadable.
                    return false;
                });
            } else {
                // No handler for module, so it's not downloadable.
                return $q.when(false);
            }
        };

        /**
         * Prefetches a list of modules using their prefetch handlers.
         * If a prefetch already exists for this site and id, returns the current promise.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#getPrefetchHandlerFor
         * @param  {String} id        An ID to identify the download. It can be used to retrieve the download promise.
         * @param  {Object[]} modules List of modules to prefetch.
         * @param  {Number} courseid  Course ID the modules belong to.
         * @return {Promise}          Promise resolved when all modules have been prefetched. Notify is called everytime
         *                            a module is prefetched, passing the module id as param.
         */
        self.prefetchAll = function(id, modules, courseid) {

            var siteid = $mmSite.getId();

            if (deferreds[siteid] && deferreds[siteid][id]) {
                // There's a prefetch ongoing, return the current promise.
                return deferreds[siteid][id].promise;
            }

            var deferred = $q.defer(),
                promises = [];

            // Store the deferred.
            if (!deferreds[siteid]) {
                deferreds[siteid] = {};
            }
            deferreds[siteid][id] = deferred;

            angular.forEach(modules, function(module) {
                // Prevent null contents.
                module.contents = module.contents || [];

                // Check if the module has a prefetch handler.
                var handler = enabledHandlers[module.modname];
                if (handler) {
                    promises.push(self.isModuleDownloadable(module, courseid).then(function(downloadable) {
                        if (!downloadable) {
                            return;
                        }

                        return handler.prefetch(module, courseid).then(function() {
                            deferred.notify(module.id);
                        });
                    }));
                }
            });

            $q.all(promises).then(function() {
                delete deferreds[siteid][id]; // Remove from array before resolving.
                deferred.resolve();
            }, function() {
                delete deferreds[siteid][id]; // Remove from array before rejecting.
                deferred.reject();
            });

            return deferred.promise;
        };

        /**
         * Update the enabled handlers for the current site.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#updatePrefetchHandler
         * @param {String} handles The module this handler handles, e.g. forum, label.
         * @param {Object} handlerInfo The handler details.
         * @param  {Number} time Time this update process started.
         * @return {Promise} Resolved when enabled, rejected when not.
         * @protected
         */
        self.updatePrefetchHandler = function(handles, handlerInfo, time) {
            var promise,
                siteId = $mmSite.getId();

            if (typeof handlerInfo.instance === 'undefined') {
                handlerInfo.instance = $mmUtil.resolveObject(handlerInfo.handler, true);
            }

            if (!$mmSite.isLoggedIn()) {
                promise = $q.reject();
            } else {
                promise = $q.when(handlerInfo.instance.isEnabled());
            }

            // Checks if the prefetch is enabled.
            return promise.catch(function() {
                return false;
            }).then(function(enabled) {
                // Verify that this call is the last one that was started.
                // Check that site hasn't changed since the check started.
                if (self.isLastUpdateCall(time) && $mmSite.isLoggedIn() && $mmSite.getId() === siteId) {
                    if (enabled) {
                        enabledHandlers[handles] = handlerInfo.instance;
                    } else {
                        delete enabledHandlers[handles];
                    }
                }
            });
        };

        /**
         * Update the handlers for the current site.
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#updatePrefetchHandlers
         * @return {Promise} Resolved when done.
         * @protected
         */
        self.updatePrefetchHandlers = function() {
            var promises = [],
                now = new Date().getTime();

            $log.debug('Updating prefetch handlers for current site.');

            lastUpdateHandlersStart = now;

            // Loop over all the prefetch handlers.
            angular.forEach(prefetchHandlers, function(handlerInfo, handles) {
                promises.push(self.updatePrefetchHandler(handles, handlerInfo, now));
            });

            return $q.all(promises).then(function() {
                return true;
            }, function() {
                // Never reject.
                return true;
            });
        };

        /**
         * Update the status of a module in the "cache".
         *
         * @module mm.core
         * @ngdoc method
         * @name $mmCoursePrefetchDelegate#updateStatusCache
         * @param {String} component     Package's component.
         * @param {Mixed} [componentId]  An ID to use in conjunction with the component.
         * @return {Void}
         */
        self.updateStatusCache = function(component, componentId, status) {
            var notify,
                cachedStatus = statusCache.getValue(component, componentId, 'status', true);

            // If the status has changed, notify that the section has changed.
            notify = cachedStatus && cachedStatus !== status;

            if (notify) {
                var sectionId = statusCache.getValue(component, componentId, 'sectionid', true);

                // Invalidate and set again.
                statusCache.invalidate(component, componentId);
                statusCache.setValue(component, componentId, 'status', status);
                statusCache.setValue(component, componentId, 'sectionid', sectionId);

                $mmEvents.trigger(mmCoreEventSectionStatusChanged, {
                    sectionid: sectionId,
                    siteid: $mmSite.getId()
                });
            } else {
                statusCache.setValue(component, componentId, 'status', status);
            }
        };

        return self;
    };


    return self;
})

.run(function($mmEvents, mmCoreEventLogin, mmCoreEventSiteUpdated, mmCoreEventLogout, $mmCoursePrefetchDelegate, $mmSite,
            mmCoreEventPackageStatusChanged, mmCoreEventRemoteAddonsLoaded) {
    $mmEvents.on(mmCoreEventLogin, $mmCoursePrefetchDelegate.updatePrefetchHandlers);
    $mmEvents.on(mmCoreEventSiteUpdated, $mmCoursePrefetchDelegate.updatePrefetchHandlers);
    $mmEvents.on(mmCoreEventRemoteAddonsLoaded, $mmCoursePrefetchDelegate.updatePrefetchHandlers);
    $mmEvents.on(mmCoreEventLogout, $mmCoursePrefetchDelegate.clearStatusCache);
    $mmEvents.on(mmCoreEventPackageStatusChanged, function(data) {
        if (data.siteid === $mmSite.getId()) {
            $mmCoursePrefetchDelegate.updateStatusCache(data.component, data.componentId, data.status);
        }
    });
});
