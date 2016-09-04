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
 * Assignments service.
 *
 * @module mm.addons.mod_assign
 * @ngdoc controller
 * @name $mmaModAssign
 */
.factory('$mmaModAssign', function($mmSite, $q, $mmUser, $mmSitesManager, mmaModAssignComponent, $mmFilepool, $mmComments,
        $mmaModAssignSubmissionDelegate, mmaModAssignSubmissionStatusNew, mmaModAssignSubmissionStatusSubmitted, $mmText) {
    var self = {};

    /**
     * Get cache key for assignment data WS calls.
     *
     * @param {Number} courseId Course ID.
     * @return {String}         Cache key.
     */
    function getAssignmentCacheKey(courseId) {
        return 'mmaModAssign:assignment:' + courseId;
    }

    /**
     * Get cache key for assignment user mappings data WS calls.
     *
     * @param {Number} assignmentId Assignment ID.
     * @return {String}             Cache key.
     */
    function getAssignmentUserMappingsCacheKey(assignmentId) {
        return 'mmaModAssign:usermappings:' + assignmentId;
    }

    /**
     * Get cache key for assignment submissions data WS calls.
     *
     * @param {Number}  assignId    Assignment id.
     * @return {String}             Cache key.
     */
    function getSubmissionsCacheKey(assignId) {
        return 'mmaModAssign:submissions:' + assignId;
    }

    /**
     * Get cache key for assignment list participants data WS calls.
     *
     * @param {Number}  assignId    Assignment id.
     * @param {Number}  groupId     Group id.
     * @return {String}             Cache key.
     */
    function listParticipantsCacheKey(assignId, groupId) {
        return listParticipantsPrefixCacheKey(assignId) + ':' + groupId;
    }

    /**
     * Get prefix cache key for assignment list participants data WS calls.
     *
     * @param {Number}  assignId    Assignment id.
     * @return {String}             Cache key.
     */
    function listParticipantsPrefixCacheKey(assignId) {
        return 'mmaModAssign:participants:' + assignId;
    }

    /**
     * Get cache key for get submission status data WS calls.
     *
     * @param {Number}  assignId   Assignment instance id.
     * @param {Number}  [userId]   User id (empty for current user).
     * @param {Number}  [isBlind]  If blind marking is enabled or not.
     * @return {String}         Cache key.
     */
    function getSubmissionStatusCacheKey(assignId, userId, isBlind) {
        if (!userId) {
            isBlind = 0;
            userId = $mmSite.getUserId();
        }
        isBlind = isBlind ? 1 : 0;
        return getSubmissionsCacheKey(assignId) + ':' + userId + ':' + isBlind;
    }

    /**
     * Get an assignment.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getAssignment
     * @param {Number} courseId   Course ID the assignment belongs to.
     * @param {Number} cmid       Assignment module ID.
     * @param {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}          Promise resolved with the assignment.
     */
    self.getAssignment = function(courseId, cmid, siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            var params = {
                    "courseids": [courseId]
                },
                preSets = {
                    cacheKey: getAssignmentCacheKey(courseId)
                };

            return site.read('mod_assign_get_assignments', params, preSets).then(function(response) {
                if (response.courses && response.courses.length) {
                    var assignments = response.courses[0].assignments;
                    for (var i = 0; i < assignments.length; i++) {
                        if (assignments[i].cmid == cmid) {
                            return assignments[i];
                        }
                    }
                }
                return $q.reject();
            });
        });
    };

    /**
     * Get an assignment user mapping for blind marking.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getAssignmentUserMappings
     * @param {Number} assignmentId Assignment Id.
     * @param {Number} userId       User Id to be blinded.
     * @param {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}          Promise resolved with the user blind id.
     */
    self.getAssignmentUserMappings = function(assignmentId, userId, siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            var params = {
                    "assignmentids": [assignmentId]
                },
                preSets = {
                    cacheKey: getAssignmentUserMappingsCacheKey(assignmentId)
                };

            return site.read('mod_assign_get_user_mappings', params, preSets).then(function(response) {
                if (userId && userId > 0 && response.assignments && response.assignments.length) {
                    var assignment = response.assignments[0];
                    if (assignment.assignmentid == assignmentId) {
                        var mappings = assignment.mappings;
                        for (var i = 0; i < mappings.length; i++) {
                            if (mappings[i].userid == userId) {
                                return mappings[i].id;
                            }
                        }
                    }
                }
                return $q.reject();
            });
        });
    };

    /**
     * Get the submission object from an attempt.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getSubmissionObjectFromAttempt
     * @param  {Object} assign  Assign.
     * @param  {Object} attempt Attempt.
     * @return {Object}         Submission object.
     */
    self.getSubmissionObjectFromAttempt = function(assign, attempt) {
        return assign.teamsubmission ? attempt.teamsubmission : attempt.submission;
    };

    /**
     * Get attachments of a submission Submission.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getSubmissionPluginAttachments
     * @param {Object} submissionPlugin Submission Plugin.
     * @return {Object[]}               Submission Pluginattachments.
     */
    self.getSubmissionPluginAttachments = function(submissionPlugin) {
        var files = [];
        if (submissionPlugin.fileareas) {
            angular.forEach(submissionPlugin.fileareas, function(filearea) {
                angular.forEach(filearea.files, function(file) {
                    var filename = file.filepath[0] == '/' ? file.filepath.substr(1) : file.filepath;
                    files.push({
                        'filename' : filename,
                        'fileurl': file.fileurl
                    });
                });
            });
        }
        return files;
    };

    /**
     * Get text of a submission plugin.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getSubmissionText
     * @param  {Object} submissionPlugin Submission Plugin.
     * @param  {Boolean} [keepUrls]      True if it should keep original URLs, false if they should be replaced.
     * @return {String}                  Submission text.
     */
    self.getSubmissionPluginText = function(submissionPlugin, keepUrls) {
        var text = '';
        if (submissionPlugin.editorfields) {
            angular.forEach(submissionPlugin.editorfields, function(field) {
                text += field.text;
            });

            if (!keepUrls && submissionPlugin.fileareas && submissionPlugin.fileareas[0]) {
                text = $mmText.replacePluginfileUrls(text, submissionPlugin.fileareas[0].files);
            }
        }

        return text;
    };

    /**
     * Get an assignment submissions.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getSubmissions
     * @param {Number}  assignId    Assignment id.
     * @param {String} [siteId]     Site ID. If not defined, current site.
     * @return {Promise}            Promise resolved with:
     *                                    - canviewsubmissions: True if user can view submissions, false otherwise.
     *                                    - submissions: Array of submissions.
     */
    self.getSubmissions = function(assignId, siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            var params = {
                    "assignmentids": [assignId]
                },
                preSets = {
                    cacheKey: getSubmissionsCacheKey(assignId)
                };

            return site.read('mod_assign_get_submissions', params, preSets).then(function(response) {
                // Check if we can view submissions, with enough permissions.
                if (response.warnings.length > 0 && response.warnings[0].warningcode == 1) {
                    return {canviewsubmissions: false};
                }

                if (response.assignments && response.assignments.length) {
                    return {
                        canviewsubmissions: true,
                        submissions: response.assignments[0].submissions
                    };
                }

                return $q.reject();
            });
        });
    };

    /**
     * Get user data for submissions since they only have userid.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getSubmissionsUserData
     * @param {Object[]} submissions Submissions to get the data for.
     * @param {Number}   courseId       ID of the course the submissions belong to.
     * @param {Number}   assignId       ID of the assignment the submissions belong to.
     * @param {Boolean}  blind          The user data need to be blinded.
     * @param {Object[]} [participants] List of participants in the assignment.
     * @return {Promise}                Promise always resolved. Resolve param is the formatted submissions.
     */
    self.getSubmissionsUserData = function(submissions, courseId, assignId, blind, participants) {
        var promises = [],
            subs = [];

        angular.forEach(submissions, function(submission) {
            var participant = false;
            if (submission.userid > 0) {
                submission.submitid = submission.userid;

                if (!blind && participants) {
                    for (var x in participants) {
                        if (participants[x].id == submission.userid) {
                            participant = participants[x];
                            delete participants[x];
                            break;
                        }
                    }
                    if (participant) {
                        submission.userfullname = participant.fullname;
                        submission.userprofileimageurl = participant.profileimageurl;
                        subs.push(submission);
                    }
                } else {
                    if (!blind) {
                        promises.push($mmUser.getProfile(submission.userid, courseId, true).then(function(user) {
                            submission.userfullname = user.fullname;
                            submission.userprofileimageurl = user.profileimageurl;
                            subs.push(submission);
                        }).catch(function() {
                            // Error getting profile, resolve promise without adding any extra data.
                        }));
                    } else {
                        // Users not blinded! (Moodle < 3.1.1, 3.2)
                        delete submission.userid;

                        promises.push(self.getAssignmentUserMappings(assignId, submission.submitid).then(function(blindId) {
                            submission.blindid = blindId;
                        }).catch(function() {
                            // Error mapping user, fail silently (Moodle < 2.6)
                        }));

                        // Add it always.
                        subs.push(submission);
                    }
                }
            } else if (submission.blindid > 0) {
                for (var x in participants) {
                    if (participants[x].id == submission.blindid) {
                        participant = participants[x];
                        delete participants[x];
                        break;
                    }
                }
                submission.submitid = submission.blindid;
                subs.push(submission);
            }
        });

        if (participants) {
            angular.forEach(participants, function(participant) {
                var submission = {
                    submitid: participant.id
                };

                if (!blind) {
                    submission.userid = participant.id;
                    submission.userfullname = participant.fullname;
                    submission.userprofileimageurl = participant.profileimageurl;
                } else {
                    submission.blindid = participant.id;
                }
                submission.status = participant.submitted ? mmaModAssignSubmissionStatusSubmitted : mmaModAssignSubmissionStatusNew;
                subs.push(submission);
            });
        }

        return $q.all(promises).then(function() {
            return subs;
        });
    };

    /**
     * Given a list of plugins, returns the plugin names that aren't supported for editing.
     *
     * @module mm.addons.mod_quiz
     * @ngdoc method
     * @name $mmaModAssign#getUnsupportedEditPlugins
     * @param  {Object[]} plugins Plugins to check.
     * @return {Promise}          Promise resolved with unsupported plugin names.
     */
    self.getUnsupportedEditPlugins = function(plugins) {
        var notSupported = [],
            promises = [];

        angular.forEach(plugins, function(plugin) {
            promises.push($q.when($mmaModAssignSubmissionDelegate.isPluginSupportedForEdit(plugin.type)).then(function(enabled) {
                if (!enabled) {
                    notSupported.push(plugin.name);
                }
            }));
        });

        return $q.all(promises).then(function() {
            return notSupported;
        });
    };

    /**
     * List the participants for a single assignment, with some summary info about their submissions.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#listParticipants
     * @param {Number}  assignId    Assignment id.
     * @param {Number}  groupId     Group id.
     * @param {String} [siteId]     Site ID. If not defined, current site.
     * @return {Promise}            Promise resolved with the list of participants and summary of submissions.
     */
    self.listParticipants = function(assignId, groupId, siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            if (!site.wsAvailable('mod_assign_list_participants')) {
                // Silently fail if is not available. (needs Moodle version >= 3.2)
                return $q.reject();
            }

            groupId = 0;
            var params = {
                    "assignid": assignId,
                    "groupid": groupId,
                    "filter": "",
                },
                preSets = {
                    cacheKey: listParticipantsCacheKey(assignId, groupId)
                };

            return site.read('mod_assign_list_participants', params, preSets);
        });
    };


    /**
     * Get information about an assignment submission status for a given user.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getSubmissionStatus
     * @param {Number}  assignId      Assignment instance id.
     * @param {Number}  [userId]      User id (empty for current user).
     * @param {Number}  [isBlind]     If blind marking is enabled or not.
     * @param {Number}  [filter=true] True to filter WS response, false otherwise.
     * @param {Boolean} [ignoreCache] True if it should ignore cached data (it will always fail in offline or server down).
     * @param {Number}  [siteId]      Site id (empty for current site).
     * @return {Promise}              Promise always resolved with the user submission status.
     */
    self.getSubmissionStatus = function(assignId, userId, isBlind, filter, ignoreCache, siteId) {
        siteId = siteId || $mmSite.getId();

        if (typeof filter == 'undefined') {
            filter = true;
        }

        return $mmSitesManager.getSite(siteId).then(function(site) {
            if (!site.wsAvailable('mod_assign_get_submission_status')) {
                // Silently fail if is not available. (needs Moodle version >= 3.1)
                return $q.reject();
            }

            userId = userId || 0;

            var params = {
                    assignid: assignId,
                    userid: userId
                },
                preSets = {
                    cacheKey: getSubmissionStatusCacheKey(assignId, userId, isBlind),
                    getCacheUsingCacheKey: true, // We use the cache key to take isBlind into account.
                    filter: filter
                };

            if (ignoreCache) {
                preSets.getFromCache = 0;
                preSets.emergencyCache = 0;
            }

            return site.read('mod_assign_get_submission_status', params, preSets).then(function(response) {
                return response;
            });
        });
    };

    /**
     * Invalidates assignment data WS calls.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#invalidateAssignmentData
     * @param {Number} courseId Course ID.
     * @param {Number}  [siteId]   Site id (empty for current site).
     * @return {Promise}        Promise resolved when the data is invalidated.
     */
    self.invalidateAssignmentData = function(courseId, siteId) {
        siteId = siteId || $mmSite.getId();
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.invalidateWsCacheForKey(getAssignmentCacheKey(courseId));
        });
    };

    /**
     * Invalidates assignment user mappings data WS calls.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#invalidateAssignmentUserMappingsData
     * @param {Number} assignmentId Assignment ID.
     * @param {Number}  [siteId]    Site id (empty for current site).
     * @return {Promise}            Promise resolved when the data is invalidated.
     */
    self.invalidateAssignmentUserMappingsData = function(assignmentId, siteId) {
        siteId = siteId || $mmSite.getId();
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.invalidateWsCacheForKey(getAssignmentUserMappingsCacheKey(assignmentId));
        });
    };

    /**
     * Invalidates assignment submissions data WS calls.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#invalidateSubmissionData
     * @param {Number}  assignId   Assignment instance id.
     * @param {Number}  [siteId]   Site id (empty for current site).
     * @return {Promise}        Promise resolved when the data is invalidated.
     */
    self.invalidateSubmissionData = function(assignId, siteId) {
        siteId = siteId || $mmSite.getId();
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.invalidateWsCacheForKey(getSubmissionsCacheKey(assignId));
        });
    };

    /**
     * Invalidates All submission status data.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#invalidateAllSubmissionData
     * @param {Number}  assignId   Assignment instance id.
     * @param {Number}  [siteId]   Site id (empty for current site).
     * @return {Promise}        Promise resolved when the data is invalidated.
     */
    self.invalidateAllSubmissionData = function(assignId, siteId) {
        siteId = siteId || $mmSite.getId();
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.invalidateWsCacheForKeyStartingWith(getSubmissionsCacheKey(assignId));
        });
    };

    /**
     * Invalidates submission status data.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#invalidateSubmissionStatusData
     * @param {Number}  assignId   Assignment instance id.
     * @param {Number}  [userId]   User id (empty for current user).
     * @param {Number}  [isBlind]  If blind marking is enabled or not.
     * @param {Number}  [siteId]   Site id (empty for current site).
     * @return {Promise}        Promise resolved when the data is invalidated.
     */
    self.invalidateSubmissionStatusData = function(assignId, userId, isBlind, siteId) {
        siteId = siteId || $mmSite.getId();
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.invalidateWsCacheForKey(getSubmissionStatusCacheKey(assignId, userId, isBlind));
        });
    };

    /**
     * Invalidates assignment participants data.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#invalidateListParticipantsData
     * @param {Number}  assignId   Assignment instance id.
     * @param {Number}  [siteId]   Site id (empty for current site).
     * @return {Promise}        Promise resolved when the data is invalidated.
     */
    self.invalidateListParticipantsData = function(assignId, siteId) {
        siteId = siteId || $mmSite.getId();
        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.invalidateWsCacheForKeyStartingWith(listParticipantsPrefixCacheKey(assignId));
        });
    };

    /**
     * Invalidate the prefetched content.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#invalidateContent
     * @param {Object} moduleId The module ID.
     * @param {Number} courseId Course ID.
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}
     */
    self.invalidateContent = function(moduleId, courseId, siteId) {
        var promises = [];
        siteId = siteId || $mmSite.getId();

        promises.push(self.getAssignment(courseId, moduleId, siteId).then(function(assign) {
            var ps = [];
            // Do not invalidate assignment data before getting assignment info, we need it!
            ps.push(self.invalidateAssignmentData(courseId, siteId));
            ps.push(self.invalidateAllSubmissionData(assign.id, siteId));
            ps.push(self.invalidateAssignmentUserMappingsData(assign.id, siteId));
            ps.push(self.invalidateListParticipantsData(assign.id, siteId));
            ps.push($mmComments.invalidateCommentsByInstance('module', assign.id, siteId));

            return $q.all(ps);
        }));

        promises.push($mmFilepool.invalidateFilesByComponent(siteId, mmaModAssignComponent, moduleId));

        return $q.all(promises);
    };

    /**
     * Check if assignments plugin is enabled in a certain site.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#isPluginEnabled
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}         Promise resolved with true if plugin is enabled, rejected or resolved with false otherwise.
     */
    self.isPluginEnabled = function(siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.wsAvailable('mod_assign_get_assignments') && site.wsAvailable('mod_assign_get_submissions');
        });
    };

    /**
     * Check if assignments plugin prefetch is enabled in a certain site.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#isPrefetchEnabled
     * @return {Boolean}         if plugin prefetch is enabled.
     */
    self.isPrefetchEnabled = function() {
        return $mmSite.wsAvailable('mod_assign_get_assignments') && $mmSite.wsAvailable('mod_assign_get_submissions') &&
            $mmSite.wsAvailable('mod_assign_get_submission_status');
    };

    /**
     * Check if save and submit assignments is enabled in site.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#isSaveAndSubmitSupported
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}         Promise resolved with true if enabled, false otherwise.
     */
    self.isSaveAndSubmitSupported = function(siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            // Even if save & submit WS were introduced in 2.6, we'll also check get_submission_status WS
            // to make sure we have all the WS to provide the whole submit experience.
            return site.wsAvailable('mod_assign_get_submission_status') && site.wsAvailable('mod_assign_save_submission') &&
                   site.wsAvailable('mod_assign_submit_for_grading');
        }).catch(function() {
            return false;
        });
    };

    /**
     * Report an assignment submission as being viewed.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#logSubmissionView
     * @param {Number} assignId     Assignment ID.
     * @param {String} [siteId]     Site ID. If not defined, current site.
     * @return {Promise}  Promise resolved when the WS call is successful.
     */
    self.logSubmissionView = function(assignId, siteId) {
        if (assignId) {
            siteId = siteId || $mmSite.getId();

            return $mmSitesManager.getSite(siteId).then(function(site) {
                var params = {
                    assignid: assignId
                };
                return site.write('mod_assign_view_submission_status', params);
            });
        }
        return $q.reject();
    };

    /**
     * Report an assignment grading table is being viewed.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#logGradingView
     * @param {Number} assignId     Assignment ID.
     * @param {String} [siteId]     Site ID. If not defined, current site.
     * @return {Promise}  Promise resolved when the WS call is successful.
     */
    self.logGradingView = function(assignId, siteId) {
        if (assignId) {
            siteId = siteId || $mmSite.getId();

            return $mmSitesManager.getSite(siteId).then(function(site) {
                var params = {
                    assignid: assignId
                };
                return site.write('mod_assign_view_grading_table', params);
            });
        }
        return $q.reject();
    };

    /**
     * Returns the badge class for a given status name
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#getSubmissionStatusClass
     * @param {Number}  status    Status name
     * @return {String}           The badge class name.
     */
    self.getSubmissionStatusClass = function(status) {
        switch (status) {
            case 'submitted':
                return 'badge-balanced';
            case 'draft':
                return 'badge-positive';
            case 'new':
            case 'noattempt':
            case 'noonlinesubmissions':
            case 'nosubmission':
                return 'badge-assertive';
        }
        return "";
    };

    /**
     * Save current user submission for a certain assignment.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#saveSubmission
     * @param  {Number} assignmentId Assign ID.
     * @param  {Object} pluginData   Data to save.
     * @return {Promise}             Promise resolved when saved, rejected otherwise.
     */
    self.saveSubmission = function(assignmentId, pluginData) {
        var params = {
            assignmentid: assignmentId,
            plugindata: pluginData
        };
        return $mmSite.write('mod_assign_save_submission', params).then(function(warnings) {
            if (warnings && warnings.length) {
                // The WebService returned warnings, reject.
                return $q.reject(warnings[0].item);
            }
        });
    };

    /**
     * Submit the current user assignment for grading.
     *
     * @module mm.addons.mod_assign
     * @ngdoc method
     * @name $mmaModAssign#submitForGrading
     * @param  {Number} assignmentId     Assign ID.
     * @param  {Boolean} acceptStatement True if submission statement is accepted, false otherwise.
     * @return {Promise}                 Promise resolved when submitted, rejected otherwise.
     */
    self.submitForGrading = function(assignmentId, acceptStatement) {
        var params = {
            assignmentid: assignmentId,
            acceptsubmissionstatement: acceptStatement ? 1 : 0
        };
        return $mmSite.write('mod_assign_submit_for_grading', params).then(function(warnings) {
            if (warnings && warnings.length) {
                // The WebService returned warnings, reject.
                return $q.reject(warnings[0].message);
            }
        });
    };

    return self;
});
