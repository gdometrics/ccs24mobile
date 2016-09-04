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

angular.module('mm.addons.mod_assign')

/**
 * Helper to gather some common functions for assign.
 *
 * @module mm.addons.mod_assign
 * @ngdoc service
 * @name $mmaModAssignHelper
 */
.factory('$mmaModAssignHelper', function($mmUtil, $mmaModAssignSubmissionDelegate, $q, $mmSite, $mmFS, $mmFilepool, $mmaModAssign,
            $mmFileUploader, mmaModAssignComponent) {

    var self = {};

    /**
     * Clear plugins temporary data because a submission was cancelled.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#clearSubmissionPluginTmpData
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to clear the data for.
     * @param  {Object} inputData  Data entered in the submission form.
     * @return {Void}
     */
    self.clearSubmissionPluginTmpData = function(assign, submission, inputData) {
        angular.forEach(submission.plugins, function(plugin) {
            $mmaModAssignSubmissionDelegate.clearTmpData(assign, submission, plugin, inputData);
        });
    };

    /**
     * Copy the data from last submitted attempt to the current submission.
     * Since we don't have any WS for that we'll have to re-submit everything manually.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#copyPreviousAttempt
     * @param  {Object} assign             Assignment.
     * @param  {Object} previousSubmission Submission to copy.
     * @return {Promise}                   Promise resolved when done.
     */
    self.copyPreviousAttempt = function(assign, previousSubmission) {
        var pluginData = {},
            promises = [],
            errorMessage;

        angular.forEach(previousSubmission.plugins, function(plugin) {
            promises.push($mmaModAssignSubmissionDelegate.copyPluginSubmissionData(assign, plugin, pluginData).catch(function(err) {
                errorMessage = err;
                return $q.reject();
            }));
        });

        return $q.all(promises).then(function() {
            // We got the plugin data. Now we need to submit it.
            if (Object.keys(pluginData).length) {
                // There's something to save.
                return $mmaModAssign.saveSubmission(assign.id, pluginData);
            }
        }).catch(function() {
            return $q.reject(errorMessage);
        });
    };

    /**
     * Retrieve the answers entered in a form.
     * We don't use ng-model because it doesn't detect changes done by JavaScript.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#getAnswersFromForm
     * @param  {Object} form Form (DOM element).
     * @return {Object}      Object with the answers.
     */
    self.getAnswersFromForm = function(form) {
        if (!form || !form.elements) {
            return {};
        }

        var answers = {};

        angular.forEach(form.elements, function(element) {
            var name = element.name || '';
            // Ignore flag and submit inputs.
            if (!name || element.type == 'submit' || element.tagName == 'BUTTON') {
                return;
            }

            // Get the value.
            if (element.type == 'checkbox') {
                answers[name] = !!element.checked;
            } else if (element.type == 'radio') {
                if (element.checked) {
                    answers[name] = element.value;
                }
            } else {
                answers[name] = element.value;
            }
        });

        return answers;
    };

    /**
     * Get the size that will be uploaded to perform an attempt copy.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#getSubmissionSizeForCopy
     * @param  {Object} assign             Assignment.
     * @param  {Object} previousSubmission Submission to copy.
     * @return {Promise}                   Promise resolved with the size.
     */
    self.getSubmissionSizeForCopy = function(assign, previousSubmission) {
        var totalSize = 0,
            promises = [];

        angular.forEach(previousSubmission.plugins, function(plugin) {
            promises.push($q.when($mmaModAssignSubmissionDelegate.getPluginSizeForCopy(assign, plugin)).then(function(size) {
                totalSize += size;
            }));
        });

        return $q.all(promises).then(function() {
            return totalSize;
        });
    };

    /**
     * Get the size that will be uploaded to save a submission.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#getSubmissionSizeForEdit
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to check data.
     * @param  {Object} inputData  Data entered in the submission form.
     * @return {Promise}           Promise resolved with the size.
     */
    self.getSubmissionSizeForEdit = function(assign, submission, inputData) {
        var totalSize = 0,
            promises = [];

        angular.forEach(submission.plugins, function(plugin) {
            var promise = $q.when($mmaModAssignSubmissionDelegate.getPluginSizeForEdit(assign, submission, plugin, inputData));
            promises.push(promise.then(function(size) {
                totalSize += size;
            }));
        });

        return $q.all(promises).then(function() {
            return totalSize;
        });
    };

    /**
     * Check if the submission data has changed for a certain submission and assign.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#hasSubmissionDataChanged
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to check data.
     * @param  {Object} inputData  Data entered in the submission form.
     * @return {Promise}           Promise resolved with true if data has changed, resolved with false otherwise.
     */
    self.hasSubmissionDataChanged = function(assign, submission, inputData) {
        var hasChanged = false,
            promises = [];

        angular.forEach(submission.plugins, function(plugin) {
            promises.push($mmaModAssignSubmissionDelegate.hasPluginDataChanged(assign, submission, plugin, inputData)
                    .then(function(changed) {
                if (changed) {
                    hasChanged = true;
                }
            }).catch(function() {
                // Ignore errors.
            }));
        });

        return $mmUtil.allPromises(promises).then(function() {
            return hasChanged;
        });
    };

    /**
     * Prepare and return the plugin data to send for a certain submission and assign.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#prepareSubmissionPluginData
     * @param  {Object} assign     Assignment.
     * @param  {Object} submission Submission to check data.
     * @param  {Object} inputData  Data entered in the submission form.
     * @return {Promise}           Promise resolved with plugin data to send to server.
     */
    self.prepareSubmissionPluginData = function(assign, submission, inputData) {
        var pluginData = {},
            promises = [],
            error;

        angular.forEach(submission.plugins, function(plugin) {
            promises.push($mmaModAssignSubmissionDelegate.preparePluginSubmissionData(
                    assign, submission, plugin, inputData, pluginData).catch(function(message) {
                error = message;
                return $q.reject();
            }));
        });

        return $mmUtil.allPromises(promises).then(function() {
            return pluginData;
        }).catch(function() {
            return $q.reject(error);
        });
    };

    /**
     * Upload a file to a draft area. If the file is an online file it will be downloaded and then re-uploaded.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#uploadFile
     * @param  {Number} assignId Assignment ID.
     * @param  {Object} file     Online file or local FileEntry.
     * @param  {Number} [itemId] Draft ID to use. Undefined or 0 to create a new draft ID.
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}         Promise resolved with the itemId.
     */
    self.uploadFile = function(assignId, file, itemId, siteId) {
        siteId = siteId || $mmSite.getId();

        var promise,
            fileName;

        if (file.filename) {
            // It's an online file. We need to download it and re-upload it.
            fileName = file.filename;
            promise = $mmFilepool.downloadUrl(siteId, file.fileurl, false, mmaModAssignComponent, assignId).then(function(path) {
                return $mmFS.getExternalFile(path);
            });
        } else {
            // Local file, we already have the file entry.
            fileName = file.name;
            promise = $q.when(file);
        }

        return promise.then(function(fileEntry) {
            // Now upload the file.
            return $mmFileUploader.uploadGenericFile(fileEntry.toURL(), fileName, fileEntry.type, true, 'draft', itemId, siteId)
                    .then(function(result) {
                return result.itemid;
            });
        });
    };

    /**
     * Given a list of files (either online files or local files), upload them to a draft area and return the draft ID.
     * Online files will be downloaded and then re-uploaded.
     * If there are no files to upload it will return a fake draft ID (1).
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssignHelper#uploadFiles
     * @param  {Number} assignId Assignment ID.
     * @param  {Object[]} files  List of files.
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}         Promise resolved with the itemId.
     */
    self.uploadFiles = function(assignId, files, siteId) {
        siteId = siteId || $mmSite.getId();

        if (!files || !files.length) {
            // Return fake draft ID.
            return $q.when(1);
        }

        // Upload only the first file first to get a draft id.
        return self.uploadFile(assignId, files[0]).then(function(itemId) {
            var promises = [],
                error;

            angular.forEach(files, function(file, index) {
                if (index === 0) {
                    // First file has already been uploaded.
                    return;
                }

                promises.push(self.uploadFile(assignId, file, itemId, siteId).catch(function(message) {
                    error = message;
                    return $q.reject();
                }));
            });

            return $q.all(promises).then(function() {
                return itemId;
            }).catch(function() {
                return $q.reject(error);
            });
        });
    };

    return self;
});
